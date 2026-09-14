package domain

import "time"

// Candle is a single OHLCV bar for a symbol at a given timeframe.
// It contains no broker-specific fields.
type Candle struct {
	// Time is the bar open time (bucket start).
	Time time.Time

	Open  float64
	High  float64
	Low   float64
	Close float64

	// Volume is total traded quantity during the bar.
	Volume int64

	// OI is open interest at bar close. Nil when the data source does not provide OI.
	OI *int64
}
