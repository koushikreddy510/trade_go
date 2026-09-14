package config

import (
	"os"
	"regexp"
	"strings"
)

var envPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}`)

// expandEnv replaces ${VAR} and ${VAR:-default} placeholders in s.
func expandEnv(s string) string {
	return envPattern.ReplaceAllStringFunc(s, func(match string) string {
		parts := envPattern.FindStringSubmatch(match)
		if len(parts) < 2 {
			return match
		}
		name := parts[1]
		defaultVal := ""
		if len(parts) >= 3 {
			defaultVal = parts[2]
		}
		if val, ok := os.LookupEnv(name); ok && val != "" {
			return val
		}
		return defaultVal
	})
}

func expandConfig(cfg *Config) {
	cfg.Redis.Addr = expandEnv(cfg.Redis.Addr)
	cfg.Flattrade.BaseURL = expandEnv(cfg.Flattrade.BaseURL)
	cfg.Flattrade.ClientID = expandEnv(cfg.Flattrade.ClientID)
	cfg.Flattrade.APIKey = expandEnv(cfg.Flattrade.APIKey)
	cfg.Flattrade.APISecret = expandEnv(cfg.Flattrade.APISecret)
	cfg.Flattrade.RedirectURL = expandEnv(cfg.Flattrade.RedirectURL)
	cfg.Strategies.DualSupertrendEMA.Symbol = expandEnv(cfg.Strategies.DualSupertrendEMA.Symbol)
	cfg.Strategies.DualSupertrendEMA.EntryTimeframe = expandEnv(cfg.Strategies.DualSupertrendEMA.EntryTimeframe)
	cfg.Strategies.DualSupertrendEMA.FilterTimeframe = expandEnv(cfg.Strategies.DualSupertrendEMA.FilterTimeframe)
	cfg.Strategies.DualSupertrendEMA.RegimeTimeframe = expandEnv(cfg.Strategies.DualSupertrendEMA.RegimeTimeframe)

	expanded := make([]string, len(cfg.Symbols))
	for i, sym := range cfg.Symbols {
		expanded[i] = expandEnv(sym)
	}
	cfg.Symbols = expanded

	expandedTF := make([]string, len(cfg.Timeframes))
	for i, tf := range cfg.Timeframes {
		expandedTF[i] = expandEnv(strings.ToLower(tf))
	}
	cfg.Timeframes = expandedTF
}
