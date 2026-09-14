package app_test

import (
	"context"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/app"
	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/logging"
)

func testConfig() *config.Config {
	return &config.Config{
		Version: 1,
		Redis: config.RedisConfig{
			Addr: "localhost:16379", // unlikely port — forces memory repo
			DB:   0,
		},
		Execution: config.ExecutionConfig{
			Mode: config.ModeSimulation,
		},
		Simulation: config.SimulationConfig{
			SymbolToken:   "26000",
			Exchange:      "MCX",
			SyntheticBars: 120,
		},
		Timeframes: []string{"1h", "2h", "4h"},
		Strategies: config.StrategiesConfig{
			DualSupertrendEMA: config.DualSupertrendEMAConfig{
				Enabled:         true,
				Symbol:          "SILVERM",
				EntryTimeframe:  "1h",
				FilterTimeframe: "2h",
				RegimeTimeframe: "4h",
				SupertrendLower: config.SupertrendParams{Period: 7, Multiplier: 2.0},
				SupertrendHigher: config.SupertrendParams{Period: 7, Multiplier: 3.0},
				EMA:             config.EMAParams{Period: 10},
			},
		},
	}
}

func TestAppRunReplaySynthetic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	cfg := testConfig()
	log := logging.New("test")

	application, err := app.New(ctx, cfg, log, app.Options{
		UseSynthetic:  true,
		RedisOptional: true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer application.Close()

	summary, err := application.RunReplay(ctx)
	if err != nil {
		t.Fatalf("RunReplay: %v", err)
	}

	if summary.Bars <= 0 {
		t.Fatalf("Bars = %d, want > 0", summary.Bars)
	}

	signalCount := summary.Buys + summary.Sells + summary.Exits + summary.Ignores
	if signalCount <= 0 {
		t.Fatalf("expected signals, got buys=%d sells=%d exits=%d ignores=%d",
			summary.Buys, summary.Sells, summary.Exits, summary.Ignores)
	}

	if summary.Buys == 0 {
		t.Logf("warning: no BUY signals (buys=%d ignores=%d bars=%d)", summary.Buys, summary.Ignores, summary.Bars)
	}
}

func TestAppRunOnceSynthetic(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	cfg := testConfig()
	log := logging.New("test")

	application, err := app.New(ctx, cfg, log, app.Options{
		UseSynthetic:  true,
		RedisOptional: true,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer application.Close()

	if err := application.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
}
