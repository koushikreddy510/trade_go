package test_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/indicator"
	"github.com/koushik-bangaru/atlas/internal/simulation"
	"github.com/koushik-bangaru/atlas/internal/strategy"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/internal/trailing"
	"github.com/koushik-bangaru/atlas/internal/workflow"
	dual "github.com/koushik-bangaru/atlas/plugins/strategies/dual_supertrend_ema"
	"github.com/koushik-bangaru/atlas/plugins/trailing/price"
)

// TestSystemOfflineBullTrendReplay exercises the full offline pipeline:
// synthetic bull trend → indicators → strategy → trade → simulation → trailing.
func TestSystemOfflineBullTrendReplay(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	cfg := dualCfg()
	strat, indEng, err := dual.NewFromConfig(cfg)
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}

	start := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	all := bullTrendCandles(80, start, 75000)

	mgr := trade.NewManager()
	indProc := indicator.NewIndicatorProcessor(indEng)
	stratProc := strategy.NewProcessor([]strategy.Strategy{strat})
	tradeProc := trade.NewProcessor(mgr, nil)
	simProc := simulation.NewProcessor(mgr, simulation.DefaultConfig())
	trailProc := trailing.NewProcessor(mgr, price.PriceTrail{TrailPoints: 100}, trailing.DefaultConfig())
	pipe := workflow.NewPipeline(indProc, stratProc, tradeProc, simProc, trailProc)

	sym := symbol()
	warmup := 25

	var (
		opened          int
		trailingMoved   bool
		slExit          bool
		initialSL       float64
	)

	for i := warmup; i <= len(all); i++ {
		window := all[:i]
		last := window[len(window)-1]

		ec := &execctx.ExecutionContext{
			WorkflowID:    "system-replay",
			ConfigVersion: 1,
			Symbol:        sym,
			Timeframe:     domain.TF1H,
			ExecutionMode: domain.ExecutionSimulation,
			Timestamp:     last.Time,
			Market: domain.MarketSnapshot{
				Symbol:    sym,
				Timeframe: domain.TF1H,
				Candles:   window,
			},
			Metadata: map[string]any{"quantity": 1},
		}

		beforeActive := len(mgr.GetActive())
		if err := pipe.Run(ctx, ec); err != nil {
			t.Fatalf("bar %d pipeline: %v", i, err)
		}
		afterActive := len(mgr.GetActive())

		if beforeActive == 0 && afterActive == 1 {
			opened++
			active := mgr.GetActive()
			if len(active) == 1 {
				initialSL = active[0].Risk.StopLoss
			}
		}

		if beforeActive == 1 && afterActive == 0 {
			slExit = true
		}

		for _, tr := range mgr.GetActive() {
			if tr.Trailing.Enabled && tr.Risk.StopLoss > initialSL && initialSL > 0 {
				trailingMoved = true
			}
		}
		for _, tr := range mgr.GetByStrategy(dual.StrategyID) {
			if tr.State == domain.TradeStateClosed && tr.Trailing.Enabled {
				trailingMoved = true
			}
		}
	}

	if opened == 0 {
		t.Fatal("expected at least one trade opened on bullish replay")
	}
	if !trailingMoved && !slExit {
		t.Fatalf("expected trailing SL move or SL exit; opened=%d trailing=%v slExit=%v",
			opened, trailingMoved, slExit)
	}

	t.Logf("system replay: opened=%d trailing=%v slExit=%v active=%d closed=%d",
		opened, trailingMoved, slExit, len(mgr.GetActive()),
		countClosed(mgr, dual.StrategyID))
}

func countClosed(mgr *trade.Manager, strategyID string) int {
	n := 0
	for _, tr := range mgr.GetByStrategy(strategyID) {
		if tr.State == domain.TradeStateClosed {
			n++
		}
	}
	return n
}
