package flattrade_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/repository"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestDefaultTokenTTL(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		now  time.Time
		want time.Duration
	}{
		{
			name: "before_530_same_day",
			now:  time.Date(2026, 8, 1, 3, 0, 0, 0, scheduler.IST),
			want: 2*time.Hour + 30*time.Minute,
		},
		{
			name: "after_530_next_day",
			now:  time.Date(2026, 8, 1, 10, 0, 0, 0, scheduler.IST),
			want: 19*time.Hour + 30*time.Minute,
		},
		{
			name: "at_530_next_day",
			now:  time.Date(2026, 8, 1, 5, 30, 0, 0, scheduler.IST),
			want: 24 * time.Hour,
		},
		{
			name: "just_before_530",
			now:  time.Date(2026, 8, 1, 5, 29, 0, 0, scheduler.IST),
			want: 1 * time.Minute,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := flattrade.DefaultTokenTTL(tc.now)
			if got != tc.want {
				t.Fatalf("DefaultTokenTTL() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestBrowserAuthURL(t *testing.T) {
	t.Parallel()

	got := flattrade.BrowserAuthURL("my-api-key")
	want := "https://auth.flattrade.in/?app_key=my-api-key"
	if got != want {
		t.Fatalf("BrowserAuthURL() = %q, want %q", got, want)
	}
}

func TestSessionManagerLoadAndExchange(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(flattrade.ExchangeTokenResponse{
			Token:  "daily-jkey",
			Client: "FT0001",
			Status: "Ok",
		})
	}))
	defer srv.Close()

	client := flattrade.NewClient(flattrade.Config{
		AuthURL:    srv.URL,
		APIKey:     "key",
		APISecret:  "secret",
		UserID:     "FT0001",
		HTTPClient: srv.Client(),
	})
	store := repository.NewMemoryTokenStore()
	mgr := flattrade.NewSessionManager(client, store, logging.New("test"))

	ctx := context.Background()

	if err := mgr.Load(ctx); err != repository.ErrTokenNotFound {
		t.Fatalf("Load() before store = %v, want ErrTokenNotFound", err)
	}

	token, err := mgr.ExchangeAndStore(ctx, "request-code")
	if err != nil {
		t.Fatalf("ExchangeAndStore: %v", err)
	}
	if token != "daily-jkey" {
		t.Fatalf("token = %q, want daily-jkey", token)
	}
	if mgr.Token() != "daily-jkey" {
		t.Fatalf("mgr.Token() = %q", mgr.Token())
	}
	if client.SessionToken() != "daily-jkey" {
		t.Fatalf("client.SessionToken() = %q", client.SessionToken())
	}

	stored, err := store.Get(ctx, repository.FlattradeTokenKey())
	if err != nil {
		t.Fatalf("store.Get: %v", err)
	}
	if stored != "daily-jkey" {
		t.Fatalf("stored token = %q", stored)
	}

	mgr2 := flattrade.NewSessionManager(
		flattrade.NewClient(flattrade.Config{UserID: "FT0001"}),
		store,
		logging.New("test"),
	)
	if err := mgr2.Load(ctx); err != nil {
		t.Fatalf("Load() after store: %v", err)
	}
	if mgr2.Token() != "daily-jkey" {
		t.Fatalf("mgr2.Token() = %q", mgr2.Token())
	}
}
