package app

import (
	"strings"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestBuildProviderSimulationSynthetic(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		Execution: config.ExecutionConfig{Mode: config.ModeSimulation},
		Simulation: config.SimulationConfig{
			SymbolToken:   "26000",
			SyntheticBars: 50,
		},
	}
	log := logging.New("test")

	provider, err := buildProvider(cfg, Options{UseSynthetic: true}, log, nil)
	if err != nil {
		t.Fatalf("buildProvider: %v", err)
	}
	if !strings.Contains(provider.Name(), "synthetic") {
		t.Fatalf("provider = %q, want synthetic fixture provider", provider.Name())
	}
}

func TestBuildProviderPaperRequiresSessionToken(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		Execution: config.ExecutionConfig{Mode: config.ModePaper},
		Simulation: config.SimulationConfig{
			SymbolToken: "26000",
		},
	}
	log := logging.New("test")
	client := flattrade.NewClient(flattrade.Config{UserID: "test"})

	_, err := buildProvider(cfg, Options{}, log, client)
	if err == nil {
		t.Fatal("expected error without session token")
	}
}

func TestBuildProviderPaperUsesFlattrade(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		Execution: config.ExecutionConfig{Mode: config.ModePaper},
		Simulation: config.SimulationConfig{
			SymbolToken: "26000",
		},
	}
	log := logging.New("test")
	client := flattrade.NewClient(flattrade.Config{UserID: "test", SessionToken: "jkey-test"})

	provider, err := buildProvider(cfg, Options{}, log, client)
	if err != nil {
		t.Fatalf("buildProvider: %v", err)
	}
	if provider.Name() != "flattrade" {
		t.Fatalf("provider = %q, want flattrade", provider.Name())
	}
}

func TestValidateExecutionModeLiveWithoutLiveOrders(t *testing.T) {
	t.Parallel()

	err := validateExecutionMode(&config.Config{
		Execution: config.ExecutionConfig{
			Mode:       config.ModeLive,
			LiveOrders: false,
		},
	})
	if err == nil {
		t.Fatal("expected error for LIVE without live_orders")
	}
}
