package trailing_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/internal/trailing"
	"github.com/koushik-bangaru/atlas/plugins/trailing/price"
)

func TestPriceTrailBuyMovesStopUp(t *testing.T) {
	t.Parallel()

	policy := price.PriceTrail{TrailPoints: 2}
	newSL, changed := policy.NextStopLoss(domain.Trade{
		Side: domain.SideBuy,
		Risk: domain.RiskState{StopLoss: 95},
	}, 104, 0)

	if !changed {
		t.Fatal("expected trailing change")
	}
	if newSL != 102 {
		t.Fatalf("newSL = %v, want 102", newSL)
	}
}

func TestTrailingProcessorMovesStopLossOnBullBar(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	mgr := trade.NewManager()
	now := time.Now().UTC()

	sig := domain.Signal{
		StrategyID: "test",
		Symbol:     domain.Symbol{Exchange: "MCX", Token: "1", Name: "TEST"},
		Action:     domain.ActionBuy,
		Quantity:   1,
		StopLoss:   95,
	}
	opened, err := mgr.OpenTrade(ctx, "wf-1", 1, sig, 100, now)
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	proc := trailing.NewProcessor(mgr, price.PriceTrail{TrailPoints: 2}, trailing.Config{})
	ec := &execctx.ExecutionContext{
		Timestamp: now,
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{
				{Close: 104},
			},
		},
	}

	if err := proc.Process(ctx, ec); err != nil {
		t.Fatalf("process: %v", err)
	}

	updated, ok := mgr.GetTrade(opened.TradeID)
	if !ok {
		t.Fatal("trade not found")
	}
	if updated.Risk.StopLoss != 102 {
		t.Fatalf("stop loss = %v, want 102", updated.Risk.StopLoss)
	}
	if !updated.Trailing.Enabled {
		t.Fatal("expected trailing enabled")
	}
}
