package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/repository"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
	"github.com/redis/go-redis/v9"
)

type authOptions struct {
	ExchangeToken string
	AuthURL       bool
	ListenAuth    bool
	AuthPort      int
}

func runAuthCommands(ctx context.Context, cfg *config.Config, log *logging.Logger, opts authOptions) (bool, error) {
	if !opts.AuthURL && opts.ExchangeToken == "" && !opts.ListenAuth {
		return false, nil
	}

	if opts.AuthURL {
		if cfg.Flattrade.APIKey == "" {
			return true, fmt.Errorf("flattrade.api_key required for -auth-url")
		}
		fmt.Println(flattrade.BrowserAuthURL(cfg.Flattrade.APIKey))
		return true, nil
	}

	redisClient, store, err := newAuthRedisAndStore(ctx, cfg)
	if err != nil {
		return true, err
	}
	defer redisClient.Close()

	if cfg.Flattrade.APIKey == "" || cfg.Flattrade.APISecret == "" {
		return true, fmt.Errorf("flattrade.api_key and flattrade.api_secret required for token exchange")
	}

	mgr := flattrade.NewSessionManager(newFlattradeClient(cfg), store, log)

	if opts.ExchangeToken != "" {
		return true, exchangeAndReport(ctx, mgr, opts.ExchangeToken, log)
	}

	return true, listenAuthCallback(ctx, mgr, cfg, opts.AuthPort, log)
}

func newAuthRedisAndStore(ctx context.Context, cfg *config.Config) (*redis.Client, repository.TokenStore, error) {
	client := repository.NewRedisClient(cfg.Redis.Addr, cfg.Redis.DB)
	if err := repository.Ping(ctx, client); err != nil {
		_ = client.Close()
		return nil, nil, fmt.Errorf("redis required for token exchange: %w", err)
	}
	return client, repository.NewRedisTokenStore(client), nil
}

func newFlattradeClient(cfg *config.Config) *flattrade.Client {
	return flattrade.NewClient(flattrade.Config{
		BaseURL:   cfg.Flattrade.BaseURL,
		APIKey:    cfg.Flattrade.APIKey,
		APISecret: cfg.Flattrade.APISecret,
		UserID:    cfg.Flattrade.ClientID,
	})
}

func exchangeAndReport(ctx context.Context, mgr *flattrade.SessionManager, requestCode string, log *logging.Logger) error {
	token, err := mgr.ExchangeAndStore(ctx, requestCode)
	if err != nil {
		return err
	}
	log.Info("flattrade token exchanged and stored",
		"token_prefix", maskToken(token),
		"ttl_hours", flattrade.DefaultTokenTTL(time.Now()).Hours(),
	)
	fmt.Println("flattrade session token stored successfully")
	return nil
}

func listenAuthCallback(ctx context.Context, mgr *flattrade.SessionManager, cfg *config.Config, port int, log *logging.Logger) error {
	if port <= 0 {
		port = 8080
	}

	done := make(chan error, 1)
	srv := &http.Server{
		Addr: fmt.Sprintf(":%d", port),
	}

	srv.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("request_code")
		if code == "" {
			http.Error(w, "missing request_code query parameter", http.StatusBadRequest)
			return
		}

		token, err := mgr.ExchangeAndStore(r.Context(), code)
		if err != nil {
			log.Error("token exchange failed", "error", err)
			http.Error(w, "token exchange failed", http.StatusInternalServerError)
			return
		}

		log.Info("flattrade token exchanged via callback",
			"token_prefix", maskToken(token),
			"ttl_hours", flattrade.DefaultTokenTTL(time.Now()).Hours(),
		)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<html><body><h1>OK</h1><p>Flattrade session token stored. You can close this window.</p></body></html>"))

		go func() {
			time.Sleep(500 * time.Millisecond)
			done <- srv.Shutdown(context.Background())
		}()
	})

	log.Info("listening for OAuth callback",
		"addr", srv.Addr,
		"redirect_hint", cfg.Flattrade.RedirectURL,
		"auth_url", flattrade.BrowserAuthURL(cfg.Flattrade.APIKey),
	)

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			done <- err
		}
	}()

	sigCtx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("auth callback server: %w", err)
		}
		fmt.Println("flattrade session token stored successfully")
		return nil
	case <-sigCtx.Done():
		_ = srv.Shutdown(context.Background())
		return sigCtx.Err()
	}
}

func maskToken(token string) string {
	if len(token) <= 8 {
		return "***"
	}
	return token[:4] + "..." + token[len(token)-4:]
}
