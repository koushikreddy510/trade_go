package dual_supertrend_ema_test

import (
	"context"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/strategy"
	"github.com/koushik-bangaru/atlas/plugins/strategies/dual_supertrend_ema"
)

func defaultConfig() config.DualSupertrendEMAConfig {
	return config.DualSupertrendEMAConfig{
		Enabled:         true,
		Symbol:          "SILVER",
		EntryTimeframe:  "1h",
		FilterTimeframe: "2h",
		RegimeTimeframe: "4h",
		SupertrendLower: config.SupertrendParams{Period: 10, Multiplier: 2.0},
		SupertrendHigher: config.SupertrendParams{Period: 10, Multiplier: 3.0},
		EMA:             config.EMAParams{Period: 50},
	}
}

func newStrategy(t *testing.T) *dual_supertrend_ema.Strategy {
	t.Helper()
	s, err := dual_supertrend_ema.New(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func baseEC(close float64) *execctx.ExecutionContext {
	return &execctx.ExecutionContext{
		Symbol: domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVER"},
		Timeframe: domain.TF1H,
		Market: domain.MarketSnapshot{
			Candles: []domain.Candle{{Close: close}},
		},
		Indicators: make(map[string]domain.IndicatorSnapshot),
	}
}

func stSnap(dir float64, line float64) domain.IndicatorSnapshot {
	return domain.IndicatorSnapshot{
		Name:       domain.IndicatorSupertrend,
		Parameters: map[string]float64{"direction": dir, "period": 10, "multiplier": 2},
		Values:     []float64{line},
	}
}

func emaSnap(v float64) domain.IndicatorSnapshot {
	return domain.IndicatorSnapshot{
		Name:       domain.IndicatorEMA,
		Parameters: map[string]float64{"period": 50},
		Values:     []float64{v},
	}
}

func TestStrategyImplementsInterface(t *testing.T) {
	var _ strategy.Strategy = (*dual_supertrend_ema.Strategy)(nil)
}

func TestEvaluateBuy(t *testing.T) {
	s := newStrategy(t)
	ec := baseEC(105.0)
	ec.Indicators[config.IndicatorSTLower] = stSnap(1, 100.0)
	ec.Indicators[config.IndicatorSTHigher] = stSnap(1, 98.0)
	ec.Indicators[config.IndicatorEMABias] = emaSnap(100.0)

	signals, err := s.Evaluate(context.Background(), ec)
	if err != nil {
		t.Fatal(err)
	}
	if len(signals) != 1 {
		t.Fatalf("expected 1 signal, got %d", len(signals))
	}
	sig := signals[0]
	if sig.Action != domain.ActionBuy {
		t.Fatalf("action = %s, want BUY", sig.Action)
	}
	if sig.Confidence != 70 {
		t.Fatalf("confidence = %d, want 70", sig.Confidence)
	}
	if sig.StopLoss != 100.0 {
		t.Fatalf("stop loss = %v, want 100", sig.StopLoss)
	}
	if sig.Metadata["reason"] != "buy_aligned" {
		t.Fatalf("reason = %q", sig.Metadata["reason"])
	}
}

func TestEvaluateSell(t *testing.T) {
	s := newStrategy(t)
	ec := baseEC(95.0)
	ec.Indicators[config.IndicatorSTLower] = stSnap(-1, 100.0)
	ec.Indicators[config.IndicatorSTHigher] = stSnap(-1, 102.0)
	ec.Indicators[config.IndicatorEMABias] = emaSnap(100.0)

	signals, err := s.Evaluate(context.Background(), ec)
	if err != nil {
		t.Fatal(err)
	}
	sig := signals[0]
	if sig.Action != domain.ActionSell {
		t.Fatalf("action = %s, want SELL", sig.Action)
	}
	if sig.Confidence != 70 {
		t.Fatalf("confidence = %d, want 70", sig.Confidence)
	}
	if sig.StopLoss != 100.0 {
		t.Fatalf("stop loss = %v, want 100", sig.StopLoss)
	}
	if sig.Metadata["reason"] != "sell_aligned" {
		t.Fatalf("reason = %q", sig.Metadata["reason"])
	}
}

func TestEvaluateIgnoreConditionsNotMet(t *testing.T) {
	s := newStrategy(t)
	ec := baseEC(95.0)
	ec.Indicators[config.IndicatorSTLower] = stSnap(1, 100.0)
	ec.Indicators[config.IndicatorSTHigher] = stSnap(1, 98.0)
	ec.Indicators[config.IndicatorEMABias] = emaSnap(100.0)

	signals, err := s.Evaluate(context.Background(), ec)
	if err != nil {
		t.Fatal(err)
	}
	sig := signals[0]
	if sig.Action != domain.ActionIgnore {
		t.Fatalf("action = %s, want IGNORE", sig.Action)
	}
	if sig.Metadata["reason"] != "conditions_not_met" {
		t.Fatalf("reason = %q", sig.Metadata["reason"])
	}
}

func TestEvaluateExitDirectionConflict(t *testing.T) {
	s := newStrategy(t)
	ec := baseEC(105.0)
	ec.Indicators[config.IndicatorSTLower] = stSnap(1, 100.0)
	ec.Indicators[config.IndicatorSTHigher] = stSnap(-1, 102.0)
	ec.Indicators[config.IndicatorEMABias] = emaSnap(100.0)

	signals, err := s.Evaluate(context.Background(), ec)
	if err != nil {
		t.Fatal(err)
	}
	sig := signals[0]
	if sig.Action != domain.ActionExit {
		t.Fatalf("action = %s, want EXIT", sig.Action)
	}
	if sig.Metadata["reason"] != "direction_conflict" {
		t.Fatalf("reason = %q", sig.Metadata["reason"])
	}
}

func TestEvaluateQuantityFromMetadata(t *testing.T) {
	s := newStrategy(t)
	ec := baseEC(105.0)
	ec.Metadata = map[string]any{dual_supertrend_ema.MetadataQuantityKey: 5}
	ec.Indicators[config.IndicatorSTLower] = stSnap(1, 100.0)
	ec.Indicators[config.IndicatorSTHigher] = stSnap(1, 98.0)
	ec.Indicators[config.IndicatorEMABias] = emaSnap(100.0)

	signals, err := s.Evaluate(context.Background(), ec)
	if err != nil {
		t.Fatal(err)
	}
	if signals[0].Quantity != 5 {
		t.Fatalf("quantity = %d, want 5", signals[0].Quantity)
	}
}

func TestNewIndicatorEngine(t *testing.T) {
	eng, err := dual_supertrend_ema.NewIndicatorEngine(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	ids := eng.IDs()
	want := []string{config.IndicatorSTLower, config.IndicatorSTHigher, config.IndicatorEMABias}
	if len(ids) != len(want) {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	for _, id := range want {
		found := false
		for _, got := range ids {
			if got == id {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing indicator id %q in %v", id, ids)
		}
	}
}

func TestNewFromConfig(t *testing.T) {
	strat, eng, err := dual_supertrend_ema.NewFromConfig(defaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	if strat.ID() != dual_supertrend_ema.StrategyID {
		t.Fatalf("id = %q", strat.ID())
	}
	if eng == nil {
		t.Fatal("expected engine")
	}
}
