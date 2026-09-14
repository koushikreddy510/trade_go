package indicator

import "github.com/koushik-bangaru/atlas/internal/domain"

// Indicator computes technical indicator values incrementally or over a full series.
type Indicator interface {
	// ID is the unique instance identifier (e.g. "ema_50", "st_lower").
	ID() string
	// Name is the indicator kind (e.g. "ema", "rsi", "supertrend").
	Name() string
	// Warmup is the number of bars required before the first valid value.
	Warmup() int
	// Update feeds one new candle and returns the snapshot built so far.
	Update(c domain.Candle) (domain.IndicatorSnapshot, error)
	// Compute recalculates from a full candle series (bootstrap / tests).
	Compute(candles []domain.Candle) (domain.IndicatorSnapshot, error)
}
