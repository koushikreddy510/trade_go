package test_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/indicator"
	"github.com/koushik-bangaru/atlas/internal/market"
)

// TestSmokeMarketToIndicators runs the Phase 2 pipeline offline:
// fixture/synthetic candles → MarketProcessor → IndicatorProcessor (dual ST + EMA).
// No Redis, Docker, or Flattrade credentials required.
func TestSmokeMarketToIndicators(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	fp := market.NewSyntheticProvider("26000", 80, start, 72000)
	svc := market.NewService(fp)

	marketProc, err := market.NewMarketProcessor(market.ProcessorConfig{
		Service:    svc,
		Timeframes: []domain.Timeframe{domain.TF1H, domain.TF2H, domain.TF4H},
		Lookback:   64,
	})
	if err != nil {
		t.Fatalf("market processor: %v", err)
	}

	eng := indicator.NewEngine()
	mustRegister := func(ind indicator.Indicator, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("new indicator: %v", err)
		}
		if err := eng.Register(ind); err != nil {
			t.Fatalf("register %s: %v", ind.ID(), err)
		}
	}
	mustRegister(indicator.NewSupertrend("st_lower", 10, 2.0))
	mustRegister(indicator.NewSupertrend("st_higher", 10, 3.0))
	mustRegister(indicator.NewEMA("ema_bias", 50))
	mustRegister(indicator.NewRSI("rsi_14", 14))

	indProc := indicator.NewIndicatorProcessor(eng)

	ec := &execctx.ExecutionContext{
		WorkflowID:    "smoke-001",
		ConfigVersion: 1,
		Symbol:        domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"},
		Timeframe:     domain.TF1H,
		ExecutionMode: domain.ExecutionSimulation,
		Timestamp:     time.Now().UTC(),
		Metadata: map[string]any{
			market.MetadataKeyTimeframes: []string{"1H", "2H", "4H"},
		},
	}

	ctx := context.Background()
	if err := marketProc.Process(ctx, ec); err != nil {
		t.Fatalf("market processor: %v", err)
	}
	if len(ec.Market.Candles) == 0 {
		t.Fatal("expected market candles from fixture")
	}

	byTF, ok := ec.Metadata[market.MetadataKeyMarketByTF].(map[domain.Timeframe]domain.MarketSnapshot)
	if !ok || len(byTF) < 2 {
		t.Fatalf("expected multi-TF snapshots in metadata, got %#v", ec.Metadata[market.MetadataKeyMarketByTF])
	}

	if err := indProc.Process(ctx, ec); err != nil {
		t.Fatalf("indicator processor: %v", err)
	}

	for _, id := range []string{"st_lower", "st_higher", "ema_bias", "rsi_14"} {
		snap, ok := ec.Indicators[id]
		if !ok {
			t.Fatalf("missing indicator %s", id)
		}
		if len(snap.Values) == 0 {
			t.Fatalf("indicator %s has empty values", id)
		}
	}

	st := ec.Indicators["st_lower"]
	dir := st.Parameters["direction"]
	if dir != 1 && dir != -1 {
		t.Fatalf("st_lower direction = %v, want ±1", dir)
	}

	emaVals := ec.Indicators["ema_bias"].Values
	t.Logf("smoke OK: candles=%d tfs=%d st_lower_dir=%v ema_last=%.2f",
		len(ec.Market.Candles),
		len(byTF),
		dir,
		emaVals[len(emaVals)-1],
	)
}

// TestSmokeFixtureJSONFile ensures the checked-in silver fixture loads.
func TestSmokeFixtureJSONFile(t *testing.T) {
	t.Parallel()

	path := filepath.Join("testdata", "candles_silver_1h.json")
	fp, err := market.NewFixtureProvider(path, "26000")
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	symbol := domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}
	candles, err := fp.FetchCandles(context.Background(), symbol, domain.TF1H, time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("FetchCandles: %v", err)
	}
	if len(candles) < 20 {
		t.Fatalf("want >=20 candles, got %d", len(candles))
	}
	t.Logf("loaded %d silver 1H fixture candles", len(candles))
}
