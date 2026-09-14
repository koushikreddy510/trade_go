package flattrade_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/market"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestParseCandleTime(t *testing.T) {
	t.Parallel()

	cases := []struct {
		input string
		want  time.Time
	}{
		{"01-08-2026 10:30:00", time.Date(2026, 8, 1, 10, 30, 0, 0, time.Local)},
		{"01/08/2026 15:45:00", time.Date(2026, 8, 1, 15, 45, 0, 0, time.Local)},
	}
	for _, tc := range cases {
		got, err := flattrade.ParseCandleTime(tc.input)
		if err != nil {
			t.Fatalf("ParseCandleTime(%q): %v", tc.input, err)
		}
		if !got.Equal(tc.want) {
			t.Fatalf("ParseCandleTime(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}

func TestMarketProviderRequiresToken(t *testing.T) {
	t.Parallel()

	client := flattrade.NewClient(flattrade.Config{UserID: "FT0001"})
	provider := flattrade.NewMarketProvider(client)

	_, err := provider.FetchCandles(context.Background(), domain.Symbol{Exchange: "MCX", Token: "1"}, domain.TF1H, time.Now().Add(-time.Hour), time.Now())
	if err != flattrade.ErrNotConfigured {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestMarketProviderTF4HRejected(t *testing.T) {
	t.Parallel()

	client := flattrade.NewClient(flattrade.Config{UserID: "FT0001", SessionToken: "jkey"})
	provider := flattrade.NewMarketProvider(client)

	_, err := provider.FetchCandles(context.Background(), domain.Symbol{Exchange: "MCX", Token: "1"}, domain.TF4H, time.Now().Add(-time.Hour), time.Now())
	if err == nil {
		t.Fatal("expected error for TF4H")
	}
	if !strings.Contains(err.Error(), "TF4H") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClientTPSeries(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/TPSeries") {
			t.Fatalf("path = %q", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "jKey=test-jkey") {
			t.Fatalf("missing jKey in body: %q", string(body))
		}

		candles := []flattrade.Candle{
			{Time: "01-08-2026 10:00:00", Into: "72000", Inth: "72500", Intl: "71800", Intc: "72200", Intv: "1500", OI: "8000"},
			{Time: "01-08-2026 11:00:00", Into: "72200", Inth: "72600", Intl: "72000", Intc: "72400", Intv: "1600", OI: "8100"},
		}
		_ = json.NewEncoder(w).Encode(candles)
	}))
	defer srv.Close()

	c := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "FT0001",
		SessionToken: "test-jkey",
		HTTPClient:   srv.Client(),
	})

	raw, err := c.TPSeries(context.Background(), flattrade.TPSeriesRequest{
		Exch:  "MCX",
		Token: "26000",
		Intrv: flattrade.Interval1H,
	})
	if err != nil {
		t.Fatalf("TPSeries: %v", err)
	}
	if len(raw) != 2 {
		t.Fatalf("got %d candles, want 2", len(raw))
	}
	if raw[0].Into != "72000" {
		t.Fatalf("first open = %q", raw[0].Into)
	}
}

func TestMarketProviderTPSeries(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		candles := []flattrade.Candle{
			{Time: "01-08-2026 10:00:00", Into: "72000", Inth: "72500", Intl: "71800", Intc: "72200", Intv: "1500"},
			{Time: "01-08-2026 11:00:00", Into: "72200", Inth: "72600", Intl: "72000", Intc: "72400", Intv: "1600"},
			{Time: "01-08-2026 12:00:00", Into: "72400", Inth: "72800", Intl: "72200", Intc: "72600", Intv: "1700"},
			{Time: "01-08-2026 13:00:00", Into: "72600", Inth: "73000", Intl: "72400", Intc: "72800", Intv: "1800"},
		}
		_ = json.NewEncoder(w).Encode(candles)
	}))
	defer srv.Close()

	c := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "FT0001",
		SessionToken: "test-jkey",
		HTTPClient:   srv.Client(),
	})
	provider := flattrade.NewMarketProvider(c)

	from := time.Date(2026, 8, 1, 9, 0, 0, 0, time.Local)
	to := time.Date(2026, 8, 1, 14, 0, 0, 0, time.Local)
	symbol := domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}

	candles, err := provider.FetchCandles(context.Background(), symbol, domain.TF1H, from, to)
	if err != nil {
		t.Fatalf("FetchCandles 1H: %v", err)
	}
	if len(candles) != 4 {
		t.Fatalf("1H: got %d candles, want 4", len(candles))
	}
	if candles[0].Open != 72000 {
		t.Fatalf("open = %v, want 72000", candles[0].Open)
	}

	svc := market.NewService(provider)
	snap4H, err := svc.Snapshot(context.Background(), symbol, domain.TF4H, 1)
	if err != nil {
		t.Fatalf("Snapshot 4H via service: %v", err)
	}
	if len(snap4H.Candles) != 1 {
		t.Fatalf("4H: got %d candles, want 1", len(snap4H.Candles))
	}
}
