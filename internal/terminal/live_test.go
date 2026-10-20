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
	"github.com/koushik-bangaru/atlas/internal/terminal"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

func TestLiveMarksPnLAndPlacesPaperOrder(t *testing.T) {
	mgr := trade.NewManager()
	live := terminal.NewLive(terminal.LiveConfig{
		Trades: mgr,
		Symbol: domain.Symbol{Exchange: "MCX", Token: "123", Name: "SILVERMIC"},
		Mode:   domain.ExecutionPaper,
	})
	live.OnTick(terminal.Quote{Exchange: "MCX", Token: "123", Symbol: "SILVERMIC", LastPrice: 75000, UpdatedAt: time.Now().UTC()})
	opened, err := live.Place(context.Background(), terminal.OrderRequest{Side: "BUY", Quantity: 2})
	if err != nil {
		t.Fatal(err)
	}
	if opened.Position.AvgPrice != 75000 || opened.StrategyID != terminal.StrategyID {
		t.Fatalf("opened = %#v", opened)
	}
	live.OnTick(terminal.Quote{Exchange: "MCX", Token: "123", LastPrice: 75100})
	got, ok := mgr.GetTrade(opened.TradeID)
	if !ok || got.Position.UnrealizedPnL != 200 {
		t.Fatalf("marked trade = %#v, %v", got, ok)
	}
	snap := live.Snapshot()
	if snap.Quote.LastPrice != 75100 || snap.PnL.UnrealizedPnL != 200 {
		t.Fatalf("snapshot = %#v", snap)
	}
}

func TestLiveRejectsLiveOrdersWhenDisabled(t *testing.T) {
	live := terminal.NewLive(terminal.LiveConfig{
		Trades:     trade.NewManager(),
		Symbol:     domain.Symbol{Exchange: "MCX", Token: "123", Name: "SILVERMIC"},
		Mode:       domain.ExecutionLive,
		LiveOrders: false,
	})
	live.OnTick(terminal.Quote{LastPrice: 1})
	if _, err := live.Place(context.Background(), terminal.OrderRequest{Side: "BUY", Quantity: 1}); err != terminal.ErrLiveOrdersDisabled {
		t.Fatalf("err = %v", err)
	}
}

func TestOrderAPIPlacesAndClosesPaperTrade(t *testing.T) {
	mgr := trade.NewManager()
	live := terminal.NewLive(terminal.LiveConfig{
		Trades: mgr,
		Symbol: domain.Symbol{Exchange: "MCX", Token: "123", Name: "SILVERMIC"},
		Mode:   domain.ExecutionPaper,
	})
	live.OnTick(terminal.Quote{Exchange: "MCX", Token: "123", LastPrice: 100})
	mux := http.NewServeMux()
	newAPI(t).WithLive(live).Register(mux)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/orders", strings.NewReader(`{"side":"BUY","quantity":1}`)))
	if w.Code != http.StatusOK {
		t.Fatalf("place status = %d: %s", w.Code, w.Body.String())
	}
	var opened domain.Trade
	if err := json.NewDecoder(w.Body).Decode(&opened); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/live", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("live status = %d", w.Code)
	}
	w = httptest.NewRecorder()
	body := `{"trade_id":"` + opened.TradeID + `","price":110}`
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/orders/close", strings.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("close status = %d: %s", w.Code, w.Body.String())
	}
	var closed domain.Trade
	if err := json.NewDecoder(w.Body).Decode(&closed); err != nil {
		t.Fatal(err)
	}
	if closed.State != domain.TradeStateClosed || closed.Position.RealizedPnL != 10 {
		t.Fatalf("closed = %#v", closed)
	}
}
