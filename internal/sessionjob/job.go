// Package sessionjob runs the daily Flattrade jKey refresh job.
//
// This is the Atlas equivalent of EventBridge → Lambda → DynamoDB:
// Scheduler (or cron/systemd) triggers once before market open; the job
// validates / refreshes the session token and stores it in Redis.
//
// Flattrade still requires a browser login to obtain request_code. Modes:
//   - check:  validate existing Redis token (fail if missing/expired)
//   - listen: open callback window so an operator can complete OAuth
//   - file:   exchange request_code from a watched file (external automation)
package sessionjob

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

// Mode controls how the daily job obtains a fresh session token.
type Mode string

const (
	ModeCheck  Mode = "check"
	ModeListen Mode = "listen"
	ModeFile   Mode = "file"
)

// Config configures the daily session-token job.
type Config struct {
	Enabled       bool
	Mode          Mode
	HourIST       int           // default 8
	MinuteIST     int           // default 15 (before MCX open)
	ListenPort    int           // default 8080
	ListenTimeout time.Duration // how long to wait for OAuth redirect
	RequestCodeFile string      // for ModeFile
	APIKey        string
}

// DefaultConfig returns pre-market defaults (08:15 IST, listen 20m).
func DefaultConfig() Config {
	return Config{
		Enabled:       true,
		Mode:          ModeCheck,
		HourIST:       8,
		MinuteIST:     15,
		ListenPort:    8080,
		ListenTimeout: 20 * time.Minute,
	}
}

// Runner executes JobSessionToken.
type Runner struct {
	cfg Config
	mgr *flattrade.SessionManager
	log *logging.Logger
}

// NewRunner builds a session-token job runner.
func NewRunner(cfg Config, mgr *flattrade.SessionManager, log *logging.Logger) *Runner {
	if log == nil {
		log = logging.New("sessionjob")
	}
	if cfg.HourIST == 0 && cfg.MinuteIST == 0 {
		cfg.HourIST, cfg.MinuteIST = 8, 15
	}
	if cfg.ListenPort == 0 {
		cfg.ListenPort = 8080
	}
	if cfg.ListenTimeout <= 0 {
		cfg.ListenTimeout = 20 * time.Minute
	}
	if cfg.Mode == "" {
		cfg.Mode = ModeCheck
	}
	return &Runner{cfg: cfg, mgr: mgr, log: log}
}

// Handler returns a scheduler handler for JobSessionToken.
func (r *Runner) Handler() scheduler.Handler {
	return func(ctx context.Context, job scheduler.Job) error {
		return r.Run(ctx)
	}
}

// Run executes one daily token ensure/refresh cycle.
func (r *Runner) Run(ctx context.Context) error {
	if r.mgr == nil {
		return fmt.Errorf("sessionjob: session manager required")
	}

	r.log.Info("session token job started", "mode", r.cfg.Mode)

	// Fast path: already-valid token in Redis.
	if err := r.mgr.EnsureValid(ctx); err == nil {
		r.log.Info("session token already valid")
		return nil
	} else {
		r.log.Warn("session token missing or invalid", "error", err)
	}

	switch r.cfg.Mode {
	case ModeCheck:
		return fmt.Errorf("sessionjob: no valid jKey in Redis — run OAuth refresh (listen/file) before market open")
	case ModeFile:
		return r.runFile(ctx)
	case ModeListen:
		return r.runListen(ctx)
	default:
		return fmt.Errorf("sessionjob: unknown mode %q", r.cfg.Mode)
	}
}

func (r *Runner) runFile(ctx context.Context) error {
	path := r.cfg.RequestCodeFile
	if path == "" {
		return fmt.Errorf("sessionjob: request_code_file required for mode=file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("sessionjob: read request_code_file: %w", err)
	}
	code := strings.TrimSpace(string(raw))
	if code == "" {
		return fmt.Errorf("sessionjob: empty request_code in %s", path)
	}
	if _, err := r.mgr.ExchangeAndStore(ctx, code); err != nil {
		return err
	}
	_ = os.Remove(path) // one-time code
	r.log.Info("session token refreshed from file")
	return nil
}

func (r *Runner) runListen(ctx context.Context) error {
	if r.cfg.APIKey == "" {
		return fmt.Errorf("sessionjob: api_key required for listen mode")
	}
	authURL := flattrade.BrowserAuthURL(r.cfg.APIKey)
	r.log.Info("waiting for OAuth callback — open this URL in a browser",
		"auth_url", authURL,
		"port", r.cfg.ListenPort,
		"timeout", r.cfg.ListenTimeout.String(),
	)

	ctx, cancel := context.WithTimeout(ctx, r.cfg.ListenTimeout)
	defer cancel()

	errCh := make(chan error, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, req *http.Request) {
		code := req.URL.Query().Get("request_code")
		if code == "" {
			code = req.URL.Query().Get("request_token")
		}
		if code == "" {
			http.Error(w, "missing request_code", http.StatusBadRequest)
			return
		}
		if _, err := r.mgr.ExchangeAndStore(req.Context(), code); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			errCh <- err
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><body><h1>Atlas session token stored</h1><p>You can close this tab.</p></body></html>"))
		errCh <- nil
	})

	srv := &http.Server{Addr: fmt.Sprintf(":%d", r.cfg.ListenPort), Handler: mux}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	defer func() { _ = srv.Shutdown(context.Background()) }()

	select {
	case <-ctx.Done():
		return fmt.Errorf("sessionjob: listen timeout waiting for OAuth: %w", ctx.Err())
	case err := <-errCh:
		if err != nil {
			return err
		}
		r.log.Info("session token refreshed via OAuth callback")
		return nil
	}
}
