package trade_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

func silverSymbol() domain.Symbol {
	return domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM", LotSize: 1}
}

func buySignal(strategy string, qty int, sl float64) domain.Signal {
	return domain.Signal{
		StrategyID: strategy,
		Symbol:     silverSymbol(),
		Action:     domain.ActionBuy,
		Quantity:   qty,
		StopLoss:   sl,
		Metadata: map[string]string{
			trade.MetadataEntryPrice: "100000",
		},
	}
}

func TestOpenTradeFromBuySignal(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)

	got, err := mgr.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 2, 99500), 100000, now)
	if err != nil {
		t.Fatalf("OpenTrade: %v", err)
	}

	if got.State != domain.TradeStateOpen {
		t.Fatalf("state = %s, want OPEN", got.State)
	}
	if got.Side != domain.SideBuy {
		t.Fatalf("side = %s, want BUY", got.Side)
	}
	if got.Position.AvgPrice != 100000 {
		t.Fatalf("avg price = %v, want 100000", got.Position.AvgPrice)
	}
	if got.Position.Quantity != 2 {
		t.Fatalf("quantity = %d, want 2", got.Position.Quantity)
	}
	if got.Risk.StopLoss != 99500 {
		t.Fatalf("stop loss = %v, want 99500", got.Risk.StopLoss)
	}

	active := mgr.GetActive()
	if len(active) != 1 {
		t.Fatalf("active trades = %d, want 1", len(active))
	}
}

func TestDuplicateOpenRejected(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	now := time.Now().UTC()
	sig := buySignal("ema", 1, 99500)

	if _, err := mgr.OpenTrade(ctx, "wf-1", 1, sig, 100000, now); err != nil {
		t.Fatalf("first open: %v", err)
	}
	_, err := mgr.OpenTrade(ctx, "wf-1", 1, sig, 100000, now)
	if err != trade.ErrDuplicateOpen {
		t.Fatalf("second open err = %v, want ErrDuplicateOpen", err)
	}
}

func TestCloseTradeByExitSignal(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	sig := buySignal("ema", 1, 99500)

	opened, err := mgr.OpenTrade(ctx, "wf-1", 1, sig, 100000, now)
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	exitSig := domain.Signal{
		StrategyID: "ema",
		Symbol:     silverSymbol(),
		Action:     domain.ActionExit,
		Metadata: map[string]string{
			trade.MetadataExitPrice: "101000",
		},
	}
	closed, err := mgr.CloseBySignal(ctx, exitSig, 101000, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if closed.State != domain.TradeStateClosed {
		t.Fatalf("state = %s, want CLOSED", closed.State)
	}
	if closed.Position.RealizedPnL != 1000 {
		t.Fatalf("realized pnl = %v, want 1000", closed.Position.RealizedPnL)
	}
	if len(mgr.GetActive()) != 0 {
		t.Fatal("expected no active trades after close")
	}
	if closed.TradeID != opened.TradeID {
		t.Fatalf("trade id mismatch: %s vs %s", closed.TradeID, opened.TradeID)
	}
}

func TestMoveStopLoss(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	now := time.Now().UTC()

	opened, err := mgr.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 1, 99500), 100000, now)
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	updated, err := mgr.MoveStopLoss(opened.TradeID, 99800)
	if err != nil {
		t.Fatalf("move sl: %v", err)
	}
	if updated.Risk.StopLoss != 99800 {
		t.Fatalf("stop loss = %v, want 99800", updated.Risk.StopLoss)
	}
}

func TestGetByStrategy(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	now := time.Now().UTC()

	if _, err := mgr.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 1, 99500), 100000, now); err != nil {
		t.Fatal(err)
	}
	exitSig := domain.Signal{StrategyID: "ema", Symbol: silverSymbol(), Action: domain.ActionExit}
	if _, err := mgr.CloseBySignal(ctx, exitSig, 101000, now); err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 1, 99400), 100500, now); err != nil {
		t.Fatal(err)
	}

	trades := mgr.GetByStrategy("ema")
	if len(trades) != 2 {
		t.Fatalf("strategy trades = %d, want 2", len(trades))
	}
}

func TestRealizedPnLSell(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	now := time.Now().UTC()

	sell := domain.Signal{
		StrategyID: "trend",
		Symbol:     silverSymbol(),
		Action:     domain.ActionSell,
		Quantity:   1,
		StopLoss:   100500,
	}
	opened, err := mgr.OpenTrade(ctx, "wf-1", 1, sell, 100000, now)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Side != domain.SideSell {
		t.Fatalf("side = %s", opened.Side)
	}

	closed, err := mgr.CloseTrade(ctx, opened.TradeID, 99500, now)
	if err != nil {
		t.Fatal(err)
	}
	if closed.Position.RealizedPnL != 500 {
		t.Fatalf("realized pnl = %v, want 500", closed.Position.RealizedPnL)
	}
}
