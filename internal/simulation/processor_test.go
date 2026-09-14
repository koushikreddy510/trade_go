package simulation_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/simulation"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

func silverSymbol() domain.Symbol {
	return domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}
}

func openBuyTrade(t *testing.T, mgr *trade.Manager, entry, sl float64) {
	t.Helper()
	ctx := context.Background()
	sig := domain.Signal{
		StrategyID: "ema",
		Symbol:     silverSymbol(),
		Action:     domain.ActionBuy,
		Quantity:   1,
		StopLoss:   sl,
	}
	if _, err := mgr.OpenTrade(ctx, "wf-1", 1, sig, entry, time.Now().UTC()); err != nil {
		t.Fatalf("open: %v", err)
	}
}

func TestSimulationStopLossHit(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	openBuyTrade(t, mgr, 100000, 99500)

	proc := simulation.NewProcessor(mgr, simulation.Config{AutoTarget: false})
	ec := &execctx.ExecutionContext{
		Timestamp: time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{High: 99900, Low: 99400, Close: 99450}},
		},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatalf("process: %v", err)
	}
	if len(ec.Trades) != 1 {
		t.Fatalf("trades = %d, want 1", len(ec.Trades))
	}
	closed := ec.Trades[0]
	if closed.State != domain.TradeStateClosed {
		t.Fatalf("state = %s, want CLOSED", closed.State)
	}
	if closed.Position.RealizedPnL != -500 {
		t.Fatalf("pnl = %v, want -500", closed.Position.RealizedPnL)
	}
}

func TestSimulationTargetHitAuto2R(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	openBuyTrade(t, mgr, 100000, 99500)

	proc := simulation.NewProcessor(mgr, simulation.DefaultConfig())
	ec := &execctx.ExecutionContext{
		Timestamp: time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{High: 101100, Low: 100200, Close: 101000}},
		},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatalf("process: %v", err)
	}
	if len(ec.Trades) != 1 {
		t.Fatalf("trades = %d, want 1", len(ec.Trades))
	}
	closed := ec.Trades[0]
	if closed.Position.RealizedPnL != 1000 {
		t.Fatalf("pnl = %v, want 1000 (2R target at 101000)", closed.Position.RealizedPnL)
	}
}

func TestSimulationSellStopLoss(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	sell := domain.Signal{
		StrategyID: "trend",
		Symbol:     silverSymbol(),
		Action:     domain.ActionSell,
		Quantity:   1,
		StopLoss:   100500,
	}
	if _, err := mgr.OpenTrade(ctx, "wf-1", 1, sell, 100000, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	proc := simulation.NewProcessor(mgr, simulation.Config{AutoTarget: false})
	ec := &execctx.ExecutionContext{
		Timestamp: time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{High: 100600, Low: 100100, Close: 100550}},
		},
	}
	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}
	if ec.Trades[0].Position.RealizedPnL != -500 {
		t.Fatalf("pnl = %v, want -500", ec.Trades[0].Position.RealizedPnL)
	}
}

func TestSimulationNoExitWhenLevelsNotTouched(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	openBuyTrade(t, mgr, 100000, 99500)

	proc := simulation.NewProcessor(mgr, simulation.Config{AutoTarget: false})
	ec := &execctx.ExecutionContext{
		Timestamp: time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{High: 100200, Low: 99800, Close: 100000}},
		},
	}
	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}
	if len(ec.Trades) != 0 {
		t.Fatalf("expected no closed trades, got %d", len(ec.Trades))
	}
	if len(mgr.GetActive()) != 1 {
		t.Fatal("trade should remain open")
	}
}

func TestSimulationExplicitTarget(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	ctx := context.Background()
	sig := domain.Signal{
		StrategyID: "ema",
		Symbol:     silverSymbol(),
		Action:     domain.ActionBuy,
		Quantity:   1,
		StopLoss:   99500,
		Metadata: map[string]string{
			trade.MetadataTarget: "101500",
		},
	}
	if _, err := mgr.OpenTrade(ctx, "wf-1", 1, sig, 100000, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	proc := simulation.NewProcessor(mgr, simulation.Config{AutoTarget: true})
	ec := &execctx.ExecutionContext{
		Timestamp: time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{High: 101600, Low: 100500, Close: 101400}},
		},
	}
	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}
	if ec.Trades[0].Position.RealizedPnL != 1500 {
		t.Fatalf("pnl = %v, want 1500", ec.Trades[0].Position.RealizedPnL)
	}
}
