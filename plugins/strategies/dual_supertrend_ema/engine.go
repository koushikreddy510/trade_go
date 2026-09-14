package dual_supertrend_ema

import (
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/indicator"
)

// NewIndicatorEngine registers st_lower, st_higher, and ema_bias for this strategy.
func NewIndicatorEngine(cfg config.DualSupertrendEMAConfig) (*indicator.Engine, error) {
	eng := indicator.NewEngine()

	stLower, err := indicator.NewSupertrend(
		config.IndicatorSTLower,
		cfg.SupertrendLower.Period,
		cfg.SupertrendLower.Multiplier,
	)
	if err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: st_lower: %w", err)
	}
	if err := eng.Register(stLower); err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: register st_lower: %w", err)
	}

	stHigher, err := indicator.NewSupertrend(
		config.IndicatorSTHigher,
		cfg.SupertrendHigher.Period,
		cfg.SupertrendHigher.Multiplier,
	)
	if err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: st_higher: %w", err)
	}
	if err := eng.Register(stHigher); err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: register st_higher: %w", err)
	}

	emaBias, err := indicator.NewEMA(config.IndicatorEMABias, cfg.EMA.Period)
	if err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: ema_bias: %w", err)
	}
	if err := eng.Register(emaBias); err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: register ema_bias: %w", err)
	}

	return eng, nil
}

// NewFromConfig builds the strategy and its indicator engine from YAML config.
func NewFromConfig(cfg config.DualSupertrendEMAConfig) (*Strategy, *indicator.Engine, error) {
	strat, err := New(cfg)
	if err != nil {
		return nil, nil, err
	}
	eng, err := NewIndicatorEngine(cfg)
	if err != nil {
		return nil, nil, err
	}
	return strat, eng, nil
}
