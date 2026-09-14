package test_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/events"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/indicator"
	"github.com/koushik-bangaru/atlas/internal/market"
	"github.com/koushik-bangaru/atlas/internal/simulation"
	"github.com/koushik-bangaru/atlas/internal/strategy"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/internal/workflow"
	dual "github.com/koushik-bangaru/atlas/plugins/strategies/dual_supertrend_ema"
)

func dualCfg() config.DualSupertrendEMAConfig {
	return config.DualSupertrendEMAConfig{
		Enabled:         true,
		Symbol:          "SILVERM",
		EntryTimeframe:  "1h",
		FilterTimeframe: "2h",
		RegimeTimeframe: "4h",
		SupertrendLower: config.SupertrendParams{Period: 7, Multiplier: 2.0},
		SupertrendHigher: config.SupertrendParams{Period: 7, Multiplier: 3.0},
		EMA:             config.EMAParams{Period: 10},
	}
}

func symbol() domain.Symbol {
	return domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM", LotSize: 1}
}

// TestIntegrationWorkflowMarketToSimulation wires every Phase 2–4 module:
// fixture market → indicators → dual ST+EMA strategy → trade manager → simulation,
// orchestrated by the workflow engine + event bus.
func TestIntegrationWorkflowMarketToSimulation(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	cfg := dualCfg()

	strat, indEng, err := dual.NewFromConfig(cfg)
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}

	start := time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC)
	// Strong clean uptrend so dual ST + EMA align for BUY.
	fp := market.NewSyntheticProvider("26000", 1, start, 70000)
	fp.SetCandles("26000", bullTrendCandles(120, start, 70000))
	svc := market.NewService(fp)

	marketProc, err := market.NewMarketProcessor(market.ProcessorConfig{
		Service:    svc,
		Timeframes: []domain.Timeframe{domain.TF1H},
		Lookback:   100,
	})
	if err != nil {
		t.Fatalf("market processor: %v", err)
	}

	mgr := trade.NewManager()
	bus := events.NewBus()
	started, unsubStart := bus.Subscribe(events.WorkflowStarted, 4)
	completed, unsubDone := bus.Subscribe(events.WorkflowCompleted, 4)
	defer unsubStart()
	defer unsubDone()

	pipe := workflow.NewPipeline(
		marketProc,
		indicator.NewIndicatorProcessor(indEng),
		strategy.NewProcessor([]strategy.Strategy{strat}),
		trade.NewProcessor(mgr, nil),
		simulation.NewProcessor(mgr, simulation.DefaultConfig()),
	)

	ec := &execctx.ExecutionContext{
		ConfigVersion: 1,
		Symbol:        symbol(),
		Timeframe:     domain.TF1H,
		ExecutionMode: domain.ExecutionSimulation,
		Timestamp:     time.Now().UTC(),
		Metadata:      map[string]any{"quantity": 1},
	}

	wf := domain.Workflow{
		Type:          domain.WorkflowTrading,
		Symbol:        symbol(),
		Timeframe:     domain.TF1H,
		Status:        domain.WorkflowCreated,
		ConfigVersion: 1,
	}

	eng := workflow.NewEngine(bus)
	if err := eng.Start(ctx, wf, ec, pipe); err != nil {
		t.Fatalf("workflow Start: %v", err)
	}

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for WorkflowStarted")
	}
	select {
	case <-completed:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for WorkflowCompleted")
	}

	if ec.WorkflowID == "" {
		t.Fatal("expected WorkflowID on execution context")
	}
	if len(ec.Market.Candles) == 0 {
		t.Fatal("expected market candles")
	}
	for _, id := range []string{config.IndicatorSTLower, config.IndicatorSTHigher, config.IndicatorEMABias} {
		if _, ok := ec.Indicators[id]; !ok {
			t.Fatalf("missing indicator %s", id)
		}
	}
	if len(ec.Signals) == 0 {
		t.Fatal("expected at least one strategy signal")
	}

	sig := ec.Signals[0]
	t.Logf("integration signal: action=%s reason=%s confidence=%d candles=%d indicators=%d trades=%d",
		sig.Action, sig.Metadata["reason"], sig.Confidence,
		len(ec.Market.Candles), len(ec.Indicators), len(ec.Trades))

	if sig.Action == "" {
		t.Fatal("empty signal action")
	}
}

// TestIntegrationForcedBuyThenStopLoss proves trade+simulation across modules
// with deterministic indicator snapshots (no randomness from ST warmup).
func TestIntegrationForcedBuyThenStopLoss(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	cfg := dualCfg()
	strat, err := dual.New(cfg)
	if err != nil {
		t.Fatalf("strategy: %v", err)
	}

	mgr := trade.NewManager()
	stratProc := strategy.NewProcessor([]strategy.Strategy{strat})
	tradeProc := trade.NewProcessor(mgr, nil)
	simProc := simulation.NewProcessor(mgr, simulation.DefaultConfig())

	entry := 100000.0
	sl := 99000.0

	ec := &execctx.ExecutionContext{
		WorkflowID:    "integ-buy-sl",
		ConfigVersion: 1,
		Symbol:        symbol(),
		Timeframe:     domain.TF1H,
		ExecutionMode: domain.ExecutionSimulation,
		Timestamp:     time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC),
		Market: domain.MarketSnapshot{
			Symbol:    symbol(),
			Timeframe: domain.TF1H,
			Candles: []domain.Candle{
				{Time: time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC), Open: entry - 100, High: entry + 50, Low: entry - 150, Close: entry, Volume: 10},
			},
		},
		Indicators: map[string]domain.IndicatorSnapshot{
			config.IndicatorSTLower: {
				Name:       domain.IndicatorSupertrend,
				Parameters: map[string]float64{"direction": 1, "period": 7, "multiplier": 2},
				Values:     []float64{sl},
			},
			config.IndicatorSTHigher: {
				Name:       domain.IndicatorSupertrend,
				Parameters: map[string]float64{"direction": 1, "period": 7, "multiplier": 3},
				Values:     []float64{sl - 200},
			},
			config.IndicatorEMABias: {
				Name:   domain.IndicatorEMA,
				Values: []float64{entry - 500},
			},
		},
		Metadata: map[string]any{"quantity": 1},
	}

	pipe := workflow.NewPipeline(stratProc, tradeProc, simProc)
	wfEng := workflow.NewEngine(nil)
	wf := domain.Workflow{ID: "integ-buy-sl", Type: domain.WorkflowTrading, Status: domain.WorkflowCreated}

	if err := wfEng.Start(ctx, wf, ec, pipe); err != nil {
		t.Fatalf("open workflow: %v", err)
	}

	active := mgr.GetActive()
	if len(active) != 1 {
		t.Fatalf("want 1 open trade after BUY, got %d (signals=%v)", len(active), ec.Signals)
	}
	if active[0].State != domain.TradeStateOpen {
		t.Fatalf("state=%s want OPEN", active[0].State)
	}
	if active[0].Side != domain.SideBuy {
		t.Fatalf("side=%s want BUY", active[0].Side)
	}

	// Second bar: low pierces stop-loss → simulation closes trade.
	ec2 := &execctx.ExecutionContext{
		WorkflowID:    "integ-buy-sl-2",
		ConfigVersion: 1,
		Symbol:        symbol(),
		Timeframe:     domain.TF1H,
		ExecutionMode: domain.ExecutionSimulation,
		Timestamp:     time.Date(2026, 8, 1, 11, 0, 0, 0, time.UTC),
		Market: domain.MarketSnapshot{
			Symbol:    symbol(),
			Timeframe: domain.TF1H,
			Candles: []domain.Candle{
				{
					Time:   time.Date(2026, 8, 1, 11, 0, 0, 0, time.UTC),
					Open:   entry,
					High:   entry + 100,
					Low:    sl - 50, // breach SL
					Close:  sl - 20,
					Volume: 12,
				},
			},
		},
		Signals: nil, // no new signals — simulation only
	}

	if err := simProc.Process(ctx, ec2); err != nil {
		t.Fatalf("simulation: %v", err)
	}

	active = mgr.GetActive()
	if len(active) != 0 {
		t.Fatalf("want 0 open trades after SL, got %d", len(active))
	}

	closed := mgr.GetByStrategy(dual.StrategyID)
	var foundClosed bool
	for _, tr := range closed {
		if tr.State == domain.TradeStateClosed {
			foundClosed = true
			if tr.Position.RealizedPnL >= 0 {
				t.Fatalf("expected negative PnL on SL exit, got %v", tr.Position.RealizedPnL)
			}
			t.Logf("SL exit OK: entry=%.0f exit_pnl=%.0f state=%s",
				tr.Position.AvgPrice, tr.Position.RealizedPnL, tr.State)
		}
	}
	if !foundClosed {
		t.Fatal("expected a CLOSED trade after stop-loss hit")
	}
}

// bullTrendCandles builds a clean monotonic uptrend (tight ranges) so dual
// Supertrend + EMA align for BUY in integration tests.
func bullTrendCandles(n int, start time.Time, base float64) []domain.Candle {
	out := make([]domain.Candle, n)
	for i := 0; i < n; i++ {
		o := base + float64(i)*150
		out[i] = domain.Candle{
			Time:   start.Add(time.Duration(i) * time.Hour),
			Open:   o,
			High:   o + 40,
			Low:    o - 15,
			Close:  o + 30,
			Volume: int64(1000 + i),
		}
	}
	return out
}

// TestIntegrationForwardWalk runs a multi-bar forward simulation loop using
// real indicators + strategy + trade manager on a bullish series.
func TestIntegrationForwardWalk(t *testing.T) {
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

	var (
		buys, sells, exits, ignores int
		opened, closed              int
	)

	warmup := 25
	for i := warmup; i <= len(all); i++ {
		window := all[:i]
		last := window[len(window)-1]

		ec := &execctx.ExecutionContext{
			WorkflowID:    "forward",
			ConfigVersion: 1,
			Symbol:        symbol(),
			Timeframe:     domain.TF1H,
			ExecutionMode: domain.ExecutionSimulation,
			Timestamp:     last.Time,
			Market: domain.MarketSnapshot{
				Symbol:    symbol(),
				Timeframe: domain.TF1H,
				Candles:   window,
			},
			Metadata: map[string]any{"quantity": 1},
		}

		if err := indProc.Process(ctx, ec); err != nil {
			t.Fatalf("bar %d indicators: %v", i, err)
		}
		if err := stratProc.Process(ctx, ec); err != nil {
			t.Fatalf("bar %d strategy: %v", i, err)
		}
		beforeOpen := len(mgr.GetActive())
		if err := tradeProc.Process(ctx, ec); err != nil {
			t.Fatalf("bar %d trade: %v", i, err)
		}
		if beforeOpen == 0 && len(mgr.GetActive()) == 1 {
			opened++
		}
		before := len(mgr.GetActive())
		if err := simProc.Process(ctx, ec); err != nil {
			t.Fatalf("bar %d simulation: %v", i, err)
		}
		after := len(mgr.GetActive())
		if before == 1 && after == 0 {
			closed++
		}

		for _, s := range ec.Signals {
			switch s.Action {
			case domain.ActionBuy:
				buys++
			case domain.ActionSell:
				sells++
			case domain.ActionExit:
				exits++
			case domain.ActionIgnore:
				ignores++
			}
		}
	}

	t.Logf("forward walk: bars=%d buys=%d sells=%d exits=%d ignores=%d opens=%d sl_closes=%d active_now=%d",
		len(all)-warmup+1, buys, sells, exits, ignores, opened, closed, len(mgr.GetActive()))

	if buys == 0 {
		t.Fatal("expected at least one BUY on bullish forward walk")
	}
	if opened == 0 {
		t.Fatal("expected trade manager to open at least one simulated trade")
	}
}
