// Package config loads, validates, and compiles Atlas YAML configuration.
package config

// ExecutionMode is the broker execution mode for Atlas.
type ExecutionMode string

const (
	ModeSimulation ExecutionMode = "SIMULATION"
	ModePaper      ExecutionMode = "PAPER"
	ModeLive       ExecutionMode = "LIVE"
)

// Config is the root Atlas configuration document.
type Config struct {
	Version    int               `yaml:"-"`
	Server     ServerConfig      `yaml:"server"`
	Redis      RedisConfig       `yaml:"redis"`
	Flattrade  FlattradeConfig   `yaml:"flattrade"`
	Execution  ExecutionConfig   `yaml:"execution"`
	Simulation SimulationConfig  `yaml:"simulation"`
	SessionJob SessionTokenJobConfig `yaml:"session_token_job"`
	Symbols    []string          `yaml:"symbols"`
	Timeframes []string          `yaml:"timeframes"`
	Strategies StrategiesConfig  `yaml:"strategies"`
	Logging    LoggingConfig     `yaml:"logging"`
	YAMLVersion string           `yaml:"version"`
}

// ServerConfig holds HTTP server settings (health, OAuth callback).
type ServerConfig struct {
	HTTPAddr string `yaml:"http_addr"` // default :8080
}

// SimulationConfig holds offline replay and fixture settings, plus optional
// live futures contract resolution (SearchScrip month picker).
type SimulationConfig struct {
	FixturePath   string `yaml:"fixture_path"`
	SymbolToken   string `yaml:"symbol_token"` // static token; ignored when resolve_futures=true
	Exchange      string `yaml:"exchange"`
	SyntheticBars int    `yaml:"synthetic_bars"`

	// ResolveFutures when true uses SearchScrip to pick the trading month contract
	// (same flow as the older Lambda get_next_x_fut). Required for PAPER/LIVE MCX micros.
	ResolveFutures bool   `yaml:"resolve_futures"`
	SearchText     string `yaml:"search_text"`   // e.g. SILVERMIC
	FuturesRoot    string `yaml:"futures_root"`  // tsym prefix; defaults to search_text
	MonthPolicy    string `yaml:"month_policy"`  // fixed | smart
	MonthOffset    int    `yaml:"month_offset"`  // for fixed policy; default 2
	NearExpiryDays int    `yaml:"near_expiry_days"` // for smart policy; default 7
}

// SessionTokenJobConfig is the daily jKey refresh job (EventBridge→Lambda equivalent).
// Runs before market open; stores token in Redis (atlas:broker:flattrade:token).
type SessionTokenJobConfig struct {
	Enabled         bool   `yaml:"enabled"`
	Mode            string `yaml:"mode"`              // check | listen | file
	HourIST         int    `yaml:"hour_ist"`          // default 8
	MinuteIST       int    `yaml:"minute_ist"`        // default 15
	ListenPort      int    `yaml:"listen_port"`       // default 8080
	ListenTimeoutMin int   `yaml:"listen_timeout_min"` // default 20
	RequestCodeFile string `yaml:"request_code_file"` // for mode=file
}

// RedisConfig holds Redis connection settings.
type RedisConfig struct {
	Addr string `yaml:"addr"`
	DB   int    `yaml:"db"`
}

// FlattradeConfig holds Flattrade Pi API v2 connection settings.
// API key + secret are created once in Flattrade Wall. Session token (jKey) is
// exchanged daily via browser OAuth and stored in Redis — see docs/flattrade-api.md.
type FlattradeConfig struct {
	BaseURL     string `yaml:"base_url"`
	ClientID    string `yaml:"client_id"`
	APIKey      string `yaml:"api_key"`
	APISecret   string `yaml:"api_secret"`   // from env ${FLATTRADE_API_SECRET}
	RedirectURL string `yaml:"redirect_url"` // optional, for docs / listen-auth helper
}

// ExecutionConfig holds runtime execution settings.
type ExecutionConfig struct {
	Mode       ExecutionMode `yaml:"mode"`
	LiveOrders bool          `yaml:"live_orders"` // LIVE only: must be true to place real broker orders
}

// StrategiesConfig groups strategy plugin configuration blocks.
type StrategiesConfig struct {
	DualSupertrendEMA DualSupertrendEMAConfig `yaml:"dual_supertrend_ema"`
}

// DualSupertrendEMAConfig configures the dual supertrend + EMA multi-timeframe strategy.
type DualSupertrendEMAConfig struct {
	Enabled         bool              `yaml:"enabled"`
	Symbol          string            `yaml:"symbol"`
	EntryTimeframe  string            `yaml:"entry_timeframe"`
	FilterTimeframe string            `yaml:"filter_timeframe"`
	RegimeTimeframe string            `yaml:"regime_timeframe"`
	SupertrendLower SupertrendParams  `yaml:"supertrend_lower"`
	SupertrendHigher SupertrendParams `yaml:"supertrend_higher"`
	EMA             EMAParams         `yaml:"ema"`
}

// SupertrendParams configures a single supertrend indicator instance.
type SupertrendParams struct {
	Period     int     `yaml:"period"`
	Multiplier float64 `yaml:"multiplier"`
}

// EMAParams configures an EMA indicator instance.
type EMAParams struct {
	Period int `yaml:"period"`
}

// LoggingConfig holds logging output settings.
type LoggingConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

// IndicatorID names compiled indicators exposed to the strategy runtime.
const (
	IndicatorSTLower  = "st_lower"
	IndicatorSTHigher = "st_higher"
	IndicatorEMABias  = "ema_bias"
)

// CompiledIndicator is a resolved indicator definition for runtime use.
type CompiledIndicator struct {
	ID         string
	Type       string
	Period     int
	Multiplier float64
	Timeframe  string
}

// CompiledStrategy is a resolved strategy plugin definition.
type CompiledStrategy struct {
	Name       string
	Enabled    bool
	Symbol     string
	Indicators map[string]CompiledIndicator
}

// CompiledConfig is the runtime view strategies and processors consume.
type CompiledConfig struct {
	Version    int
	Mode       ExecutionMode
	Symbols    []string
	Timeframes []string
	Strategies []CompiledStrategy
	Redis      RedisConfig
	Flattrade  FlattradeConfig
	Logging    LoggingConfig
}
