package strategy_test

import (
	"context"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/strategy"
	"github.com/koushik-bangaru/atlas/plugins/strategies/dual_supertrend_ema"
)

type stubStrategy struct {
	id      string
	signals []domain.Signal
}

func (s *stubStrategy) ID() string { return s.id }

func (s *stubStrategy) Evaluate(ctx context.Context, ec *execctx.ExecutionContext) ([]domain.Signal, error) {
	_ = ctx
	_ = ec
	return s.signals, nil
}

func TestRegistryRegister(t *testing.T) {
	reg := strategy.NewRegistry()
	s, err := dual_supertrend_ema.New(config.DualSupertrendEMAConfig{
		Symbol:          "SILVER",
		EntryTimeframe:  "1h",
		FilterTimeframe: "2h",
		RegimeTimeframe: "4h",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(s); err != nil {
		t.Fatal(err)
	}
	if err := reg.Register(s); err == nil {
		t.Fatal("expected duplicate register error")
	}
	got, ok := reg.Get(dual_supertrend_ema.StrategyID)
	if !ok || got.ID() != dual_supertrend_ema.StrategyID {
		t.Fatalf("registry get failed: ok=%v", ok)
	}
}

func TestProcessorAppendsSignals(t *testing.T) {
	sig := domain.Signal{
		StrategyID: "stub",
		Symbol:     domain.Symbol{Name: "SILVER"},
		Action:     domain.ActionBuy,
		Confidence: 70,
		Metadata:   map[string]string{"reason": "test"},
	}
	proc := strategy.NewProcessor([]strategy.Strategy{
		&stubStrategy{id: "stub", signals: []domain.Signal{sig}},
	})

	ec := &execctx.ExecutionContext{
		Symbol: domain.Symbol{Name: "SILVER"},
		Market: domain.MarketSnapshot{Candles: []domain.Candle{{Close: 100}}},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}
	if len(ec.Signals) != 1 {
		t.Fatalf("expected 1 signal, got %d", len(ec.Signals))
	}
	if ec.Signals[0].Action != domain.ActionBuy {
		t.Fatalf("action = %s", ec.Signals[0].Action)
	}
}

func TestProcessorCollectsMultipleStrategies(t *testing.T) {
	proc := strategy.NewProcessor([]strategy.Strategy{
		&stubStrategy{id: "a", signals: []domain.Signal{{StrategyID: "a", Action: domain.ActionBuy}}},
		&stubStrategy{id: "b", signals: []domain.Signal{{StrategyID: "b", Action: domain.ActionSell}}},
	})
	ec := &execctx.ExecutionContext{}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}
	if len(ec.Signals) != 2 {
		t.Fatalf("expected 2 signals, got %d", len(ec.Signals))
	}
}

func TestProcessorFromRegistry(t *testing.T) {
	reg := strategy.NewRegistry()
	reg.Register(&stubStrategy{id: "x", signals: []domain.Signal{{StrategyID: "x", Action: domain.ActionIgnore}}})
	proc := strategy.NewProcessorFromRegistry(reg)
	ec := &execctx.ExecutionContext{}
	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}
	if len(ec.Signals) != 1 {
		t.Fatalf("expected 1 signal, got %d", len(ec.Signals))
	}
}
