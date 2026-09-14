package domain

// MarketSnapshot captures the latest candle history for a symbol at a timeframe.
// Strategies and indicators consume this view rather than raw broker payloads.
type MarketSnapshot struct {
	Symbol    Symbol
	Timeframe Timeframe
	Candles   []Candle
}
