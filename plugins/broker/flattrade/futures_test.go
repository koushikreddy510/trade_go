package flattrade_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/instruments"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestResolveFutures(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"stat":"Ok",
			"values":[
				{"exch":"MCX","tsym":"SILVERMIC26JUL31","token":"111","instname":"FUTCOM","ls":"1","ti":"1"},
				{"exch":"MCX","tsym":"SILVERMIC26SEP30","token":"333","instname":"FUTCOM","ls":"1","ti":"1"},
				{"exch":"MCX","tsym":"SILVERMIC26OCT30","token":"444","instname":"FUTCOM","ls":"1","ti":"1"}
			]
		}`))
	}))
	defer srv.Close()

	client := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "FT029182",
		SessionToken: "jkey",
		HTTPClient:   srv.Client(),
	})

	now := time.Date(2026, time.July, 15, 12, 0, 0, 0, scheduler.IST)
	got, err := client.ResolveFutures(context.Background(), "MCX", "SILVERMIC", instruments.SelectConfig{
		Root:        "SILVERMIC",
		Policy:      instruments.PolicyFixed,
		MonthOffset: 2,
		InstFilter:  "FUTCOM",
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.Token != "333" || got.Tsym != "SILVERMIC26SEP30" {
		t.Fatalf("got %+v", got)
	}
}
