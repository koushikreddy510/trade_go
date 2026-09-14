package trade_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/simulation"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/plugins/broker/paper"
)

func TestTradeProcessorOpensFromBuySignal(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	proc := trade.NewProcessor(mgr, nil)

	ec := &execctx.ExecutionContext{
		WorkflowID:    "wf-1",
		ConfigVersion: 1,
		Timestamp:     time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{Close: 100000}},
		},
		Signals: []domain.Signal{
			{
				StrategyID: "ema",
				Symbol:     silverSymbol(),
				Action:     domain.ActionBuy,
				Quantity:   1,
				StopLoss:   99500,
			},
		},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatalf("process: %v", err)
	}
	if len(ec.Trades) != 1 {
		t.Fatalf("trades = %d, want 1", len(ec.Trades))
	}
	if ec.Trades[0].State != domain.TradeStateOpen {
		t.Fatalf("state = %s, want OPEN", ec.Trades[0].State)
	}
	if ec.Trades[0].Position.AvgPrice != 100000 {
		t.Fatalf("entry = %v, want 100000", ec.Trades[0].Position.AvgPrice)
	}
}

func TestTradeProcessorRejectsDuplicateOpen(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	proc := trade.NewProcessor(mgr, nil)

	sig := domain.Signal{
		StrategyID: "ema",
		Symbol:     silverSymbol(),
		Action:     domain.ActionBuy,
		Quantity:   1,
		StopLoss:   99500,
	}
	ec := &execctx.ExecutionContext{
		WorkflowID: "wf-1",
		Timestamp:  time.Now().UTC(),
		Market:     domain.MarketSnapshot{Candles: []domain.Candle{{Close: 100000}}},
		Signals:    []domain.Signal{sig, sig},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatalf("process: %v", err)
	}
	if len(ec.Trades) != 1 {
		t.Fatalf("trades = %d, want 1 (duplicate ignored)", len(ec.Trades))
	}
}

func TestTradeProcessorClosesOnExitSignal(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	tradeProc := trade.NewProcessor(mgr, nil)
	ctx := context.Background()
	now := time.Now().UTC()

	openEC := &execctx.ExecutionContext{
		WorkflowID: "wf-1",
		Timestamp:  now,
		Market:     domain.MarketSnapshot{Candles: []domain.Candle{{Close: 100000}}},
		Signals: []domain.Signal{{
			StrategyID: "ema",
			Symbol:     silverSymbol(),
			Action:     domain.ActionBuy,
			Quantity:   1,
			StopLoss:   99500,
		}},
	}
	if err := tradeProc.Process(ctx, openEC); err != nil {
		t.Fatal(err)
	}

	exitEC := &execctx.ExecutionContext{
		WorkflowID: "wf-1",
		Timestamp:  now,
		Market:     domain.MarketSnapshot{Candles: []domain.Candle{{Close: 101000}}},
		Signals: []domain.Signal{{
			StrategyID: "ema",
			Symbol:     silverSymbol(),
			Action:     domain.ActionExit,
		}},
	}
	if err := tradeProc.Process(ctx, exitEC); err != nil {
		t.Fatal(err)
	}
	if len(exitEC.Trades) != 1 {
		t.Fatalf("exit trades = %d, want 1", len(exitEC.Trades))
	}
	if exitEC.Trades[0].State != domain.TradeStateClosed {
		t.Fatalf("state = %s, want CLOSED", exitEC.Trades[0].State)
	}
	if exitEC.Trades[0].Position.RealizedPnL != 1000 {
		t.Fatalf("pnl = %v, want 1000", exitEC.Trades[0].Position.RealizedPnL)
	}
}

func TestTradeProcessorPaperBrokerPlacesOrder(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	pb := paper.New()
	proc := trade.NewProcessor(mgr, &trade.ProcessorConfig{
		Broker: pb,
		Mode:   domain.ExecutionPaper,
	})

	ec := &execctx.ExecutionContext{
		WorkflowID:    "wf-1",
		ConfigVersion: 1,
		Timestamp:     time.Now().UTC(),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{Close: 100000}},
		},
		Signals: []domain.Signal{
			{
				StrategyID: "ema",
				Symbol:     silverSymbol(),
				Action:     domain.ActionBuy,
				Quantity:   1,
				StopLoss:   99500,
			},
		},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatalf("process: %v", err)
	}
	if len(ec.Trades) != 1 {
		t.Fatalf("trades = %d, want 1", len(ec.Trades))
	}
	if !strings.HasPrefix(ec.Trades[0].EntryOrderID, "SIM-") {
		t.Fatalf("entry order id = %q, want SIM- prefix", ec.Trades[0].EntryOrderID)
	}
	if ec.Trades[0].State != domain.TradeStateOpen {
		t.Fatalf("state = %s, want OPEN", ec.Trades[0].State)
	}
}

func TestProcessorChainTradeThenSimulation(t *testing.T) {
	t.Parallel()

	mgr := trade.NewManager()
	tradeProc := trade.NewProcessor(mgr, nil)
	simProc := simulation.NewProcessor(mgr, simulation.DefaultConfig())
	ctx := context.Background()
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)

	// Step 1: BUY signal opens trade.
	openEC := &execctx.ExecutionContext{
		WorkflowID: "wf-1",
		Timestamp:  now,
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{Close: 100000, High: 100100, Low: 99900}},
		},
		Signals: []domain.Signal{{
			StrategyID: "ema",
			Symbol:     silverSymbol(),
			Action:     domain.ActionBuy,
			Quantity:   1,
			StopLoss:   99500,
		}},
	}
	if err := tradeProc.Process(ctx, openEC); err != nil {
		t.Fatalf("trade open: %v", err)
	}
	if len(mgr.GetActive()) != 1 {
		t.Fatal("expected one active trade")
	}

	// Step 2: next candle hits stop loss.
	slEC := &execctx.ExecutionContext{
		WorkflowID: "wf-1",
		Timestamp:  now.Add(time.Hour),
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{
				Close: 99400,
				High:  99600,
				Low:   99400,
			}},
		},
	}
	if err := simProc.Process(ctx, slEC); err != nil {
		t.Fatalf("simulation: %v", err)
	}
	if len(slEC.Trades) != 1 {
		t.Fatalf("sim trades = %d, want 1", len(slEC.Trades))
	}
	closed := slEC.Trades[0]
	if closed.State != domain.TradeStateClosed {
		t.Fatalf("state = %s, want CLOSED", closed.State)
	}
	if closed.Position.RealizedPnL >= 0 {
		t.Fatalf("pnl = %v, want negative", closed.Position.RealizedPnL)
	}
	if closed.Position.RealizedPnL != -500 {
		t.Fatalf("pnl = %v, want -500", closed.Position.RealizedPnL)
	}
	if len(mgr.GetActive()) != 0 {
		t.Fatal("expected no active trades after SL")
	}
}
