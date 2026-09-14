package config

// Compile builds the runtime CompiledConfig view from a validated Config.
func Compile(cfg *Config) *CompiledConfig {
	compiled := &CompiledConfig{
		Version:    cfg.Version,
		Mode:       cfg.Execution.Mode,
		Symbols:    append([]string(nil), cfg.Symbols...),
		Timeframes: append([]string(nil), cfg.Timeframes...),
		Redis:      cfg.Redis,
		Flattrade:  cfg.Flattrade,
		Logging:    cfg.Logging,
	}

	if cfg.Strategies.DualSupertrendEMA.Enabled {
		s := cfg.Strategies.DualSupertrendEMA
		compiled.Strategies = append(compiled.Strategies, CompiledStrategy{
			Name:    "dual_supertrend_ema",
			Enabled: true,
			Symbol:  s.Symbol,
			Indicators: map[string]CompiledIndicator{
				IndicatorSTLower: {
					ID:         IndicatorSTLower,
					Type:       "supertrend",
					Period:     s.SupertrendLower.Period,
					Multiplier: s.SupertrendLower.Multiplier,
					Timeframe:  s.EntryTimeframe,
				},
				IndicatorSTHigher: {
					ID:         IndicatorSTHigher,
					Type:       "supertrend",
					Period:     s.SupertrendHigher.Period,
					Multiplier: s.SupertrendHigher.Multiplier,
					Timeframe:  s.FilterTimeframe,
				},
				IndicatorEMABias: {
					ID:        IndicatorEMABias,
					Type:      "ema",
					Period:    s.EMA.Period,
					Timeframe: s.EntryTimeframe,
				},
			},
		})
	}

	return compiled
}
