package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/config"
)

const validYAML = `
version: "1"

redis:
  addr: "${REDIS_ADDR:-localhost:6379}"
  db: 0

flattrade:
  base_url: "https://piconnect.flattrade.in/PiConnectAPI"
  client_id: "${FLATTRADE_CLIENT_ID:-}"
  api_key: "${FLATTRADE_API_KEY:-}"

execution:
  mode: SIMULATION

symbols:
  - SILVER

timeframes:
  - 1h
  - 2h

strategies:
  dual_supertrend_ema:
    enabled: true
    symbol: SILVER
    entry_timeframe: 1h
    filter_timeframe: 2h
    regime_timeframe: 4h
    supertrend_lower:
      period: 10
      multiplier: 2.0
    supertrend_higher:
      period: 10
      multiplier: 3.0
    ema:
      period: 50

logging:
  level: info
  format: json
`

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "atlas.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

func TestLoadHappyPath(t *testing.T) {
	path := writeTempConfig(t, validYAML)
	loader := config.NewFileLoader()

	cfg, err := loader.Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Version != 1 {
		t.Errorf("Version = %d, want 1", cfg.Version)
	}
	if cfg.Execution.Mode != config.ModeSimulation {
		t.Errorf("Mode = %q, want SIMULATION", cfg.Execution.Mode)
	}
	if cfg.Redis.Addr != "localhost:6379" {
		t.Errorf("Redis.Addr = %q, want localhost:6379", cfg.Redis.Addr)
	}
	if loader.Version() != 1 {
		t.Errorf("loader.Version() = %d, want 1", loader.Version())
	}
	if loader.Current() != cfg {
		t.Error("loader.Current() should return loaded config")
	}

	compiled := config.Compile(cfg)
	if compiled.Mode != config.ModeSimulation {
		t.Errorf("compiled.Mode = %q, want SIMULATION", compiled.Mode)
	}
	if len(compiled.Strategies) != 1 {
		t.Fatalf("compiled.Strategies len = %d, want 1", len(compiled.Strategies))
	}
	indicators := compiled.Strategies[0].Indicators
	for _, id := range []string{config.IndicatorSTLower, config.IndicatorSTHigher, config.IndicatorEMABias} {
		if _, ok := indicators[id]; !ok {
			t.Errorf("missing compiled indicator %q", id)
		}
	}
}

func TestLoadEnvExpansion(t *testing.T) {
	t.Setenv("REDIS_ADDR", "redis.example:6380")

	path := writeTempConfig(t, validYAML)
	cfg, err := config.NewFileLoader().Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Redis.Addr != "redis.example:6380" {
		t.Errorf("Redis.Addr = %q, want redis.example:6380", cfg.Redis.Addr)
	}
}

func TestLoadInvalidMode(t *testing.T) {
	invalid := validYAML
	invalid = replaceLine(invalid, "  mode: SIMULATION", "  mode: INVALID")
	path := writeTempConfig(t, invalid)

	_, err := config.NewFileLoader().Load(path)
	if err == nil {
		t.Fatal("Load() expected error for invalid mode")
	}
}

func TestReloadBumpsVersion(t *testing.T) {
	path := writeTempConfig(t, validYAML)
	loader := config.NewFileLoader()

	if _, err := loader.Load(path); err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	reloaded, err := loader.Reload()
	if err != nil {
		t.Fatalf("Reload() error = %v", err)
	}
	if reloaded.Version != 2 {
		t.Errorf("Reload() Version = %d, want 2", reloaded.Version)
	}
	if loader.Version() != 2 {
		t.Errorf("loader.Version() = %d, want 2", loader.Version())
	}
}

func TestValidateMissingTimeframes(t *testing.T) {
	yaml := validYAML
	yaml = replaceLine(yaml, "timeframes:\n  - 1h\n  - 2h", "timeframes: []")
	path := writeTempConfig(t, yaml)

	_, err := config.NewFileLoader().Load(path)
	if err == nil {
		t.Fatal("Load() expected error for missing timeframes")
	}
}

func replaceLine(s, old, new string) string {
	if old == "" {
		return s
	}
	out := s
	for {
		idx := indexOf(out, old)
		if idx < 0 {
			return out
		}
		out = out[:idx] + new + out[idx+len(old):]
	}
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
