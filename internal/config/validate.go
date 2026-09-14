package config

import (
	"fmt"
	"strings"
)

func validate(cfg *Config) error {
	if err := validateExecutionMode(cfg.Execution.Mode); err != nil {
		return err
	}
	if len(cfg.Timeframes) == 0 {
		return fmt.Errorf("at least one timeframe is required")
	}
	if cfg.Strategies.DualSupertrendEMA.Enabled {
		if err := validateDualSupertrendEMA(&cfg.Strategies.DualSupertrendEMA); err != nil {
			return err
		}
	}
	return nil
}

func validateExecutionMode(mode ExecutionMode) error {
	switch mode {
	case ModeSimulation, ModePaper, ModeLive:
		return nil
	default:
		return fmt.Errorf("execution.mode must be SIMULATION, PAPER, or LIVE, got %q", mode)
	}
}

func validateDualSupertrendEMA(s *DualSupertrendEMAConfig) error {
	if strings.TrimSpace(s.Symbol) == "" {
		return fmt.Errorf("strategies.dual_supertrend_ema.symbol is required when enabled")
	}
	if strings.TrimSpace(s.EntryTimeframe) == "" {
		return fmt.Errorf("strategies.dual_supertrend_ema.entry_timeframe is required when enabled")
	}
	if strings.TrimSpace(s.FilterTimeframe) == "" {
		return fmt.Errorf("strategies.dual_supertrend_ema.filter_timeframe is required when enabled")
	}
	if strings.TrimSpace(s.RegimeTimeframe) == "" {
		return fmt.Errorf("strategies.dual_supertrend_ema.regime_timeframe is required when enabled")
	}
	if s.SupertrendLower.Period <= 0 {
		return fmt.Errorf("strategies.dual_supertrend_ema.supertrend_lower.period must be > 0")
	}
	if s.SupertrendLower.Multiplier <= 0 {
		return fmt.Errorf("strategies.dual_supertrend_ema.supertrend_lower.multiplier must be > 0")
	}
	if s.SupertrendHigher.Period <= 0 {
		return fmt.Errorf("strategies.dual_supertrend_ema.supertrend_higher.period must be > 0")
	}
	if s.SupertrendHigher.Multiplier <= 0 {
		return fmt.Errorf("strategies.dual_supertrend_ema.supertrend_higher.multiplier must be > 0")
	}
	if s.EMA.Period <= 0 {
		return fmt.Errorf("strategies.dual_supertrend_ema.ema.period must be > 0")
	}
	return nil
}
