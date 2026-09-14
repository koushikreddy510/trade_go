package sessionjob_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/repository"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
	"github.com/koushik-bangaru/atlas/internal/sessionjob"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestRunnerCheckValidToken(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"stat":"Ok","actid":"DEMO"}`))
	}))
	defer srv.Close()

	store := repository.NewMemoryTokenStore()
	_ = store.Set(context.Background(), repository.FlattradeTokenKey(), "jkey-demo", time.Hour)

	client := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "DEMO",
		SessionToken: "jkey-demo",
		HTTPClient:   srv.Client(),
	})
	mgr := flattrade.NewSessionManager(client, store, logging.New("test"))

	runner := sessionjob.NewRunner(sessionjob.Config{Mode: sessionjob.ModeCheck}, mgr, logging.New("test"))
	if err := runner.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestRunnerCheckMissingToken(t *testing.T) {
	t.Parallel()

	store := repository.NewMemoryTokenStore()
	client := flattrade.NewClient(flattrade.Config{UserID: "DEMO"})
	mgr := flattrade.NewSessionManager(client, store, logging.New("test"))
	runner := sessionjob.NewRunner(sessionjob.Config{Mode: sessionjob.ModeCheck}, mgr, logging.New("test"))

	err := runner.Run(context.Background())
	if err == nil {
		t.Fatal("expected error when token missing")
	}
}

func TestScheduleDailyAt_fires(t *testing.T) {
	t.Parallel()

	var fired int
	s := scheduler.New(nil)
	s.Register(scheduler.JobSessionToken, func(ctx context.Context, job scheduler.Job) error {
		fired++
		return nil
	})

	current := time.Date(2026, 8, 1, 8, 15, 0, 0, scheduler.IST)
	s.SetClock(func() time.Time { return current })
	s.ScheduleDailyAt(scheduler.JobSessionToken, 8, 15, map[string]string{"mode": "check"})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Start(ctx) }()

	time.Sleep(30 * time.Millisecond)
	current = current.Add(time.Second)
	time.Sleep(50 * time.Millisecond)
	cancel()
	<-done

	if fired < 1 {
		t.Fatalf("expected session token job to fire, got %d", fired)
	}
}

func TestNextDailyAt(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 1, 9, 0, 0, 0, scheduler.IST)
	next := scheduler.NextDailyAtOnOrAfter(8, 15, now)
	want := time.Date(2026, 8, 2, 8, 15, 0, 0, scheduler.IST)
	if !next.Equal(want) {
		t.Fatalf("got %v want %v", next, want)
	}
}
