package terminal_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/indicator"
	"github.com/koushik-bangaru/atlas/internal/market"
	"github.com/koushik-bangaru/atlas/internal/terminal"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/plugins/indicators/ema"
)

type provider struct{ candles []domain.Candle }

func (p provider) Name() string { return "test" }
func (p provider) FetchCandles(context.Context, domain.Symbol, domain.Timeframe, time.Time, time.Time) ([]domain.Candle, error) {
	return p.candles, nil
}

func newAPI(t *testing.T) *terminal.API {
	t.Helper()
	symbol := domain.Symbol{Exchange: "MCX", Token: "123", Name: "SILVERMIC"}
	candles := []domain.Candle{
		{Time: time.Date(2026, 1, 1, 9, 0, 0, 0, time.UTC), Open: 10, High: 12, Low: 9, Close: 11},
		{Time: time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC), Open: 11, High: 13, Low: 10, Close: 12},
	}
	engine := indicator.NewEngine()
	ind, err := ema.New("ema_2", 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.Register(ind); err != nil {
		t.Fatal(err)
	}
	return terminal.NewAPI(terminal.NewService(market.NewService(provider{candles: candles}), engine, trade.NewManager(), terminal.NewMemoryDrawingStore(), symbol, 20))
}

func TestChartReturnsCandlesIndicatorsAndPositions(t *testing.T) {
	mux := http.NewServeMux()
	newAPI(t).Register(mux)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/chart?timeframe=1H", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Candles    []domain.Candle                     `json:"candles"`
		Indicators map[string]domain.IndicatorSnapshot `json:"indicators"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Candles) != 2 || len(got.Indicators["ema_2"].Values) != 2 {
		t.Fatalf("unexpected chart response: %#v", got)
	}
}

func TestDrawingRoundTrip(t *testing.T) {
	mux := http.NewServeMux()
	newAPI(t).Register(mux)
	body := `{"id":"support-1","kind":"horizontal_line","points":[{"time":1767258000,"price":75000}],"color":"#2ecc71"}`
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/v1/drawings?timeframe=1H", strings.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("put status = %d: %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/drawings?timeframe=1H", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("get status = %d", w.Code)
	}
	var got []terminal.Drawing
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Symbol.Token != "123" {
		t.Fatalf("drawings = %#v", got)
	}
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/v1/drawings?timeframe=1H&id=support-1", nil))
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d", w.Code)
	}
}

func TestDrawingRejectsInvalidInput(t *testing.T) {
	mux := http.NewServeMux()
	newAPI(t).Register(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/v1/drawings?timeframe=1H", strings.NewReader(`{"id":"x","kind":"bad","points":[]}`)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", w.Code)
	}
}
