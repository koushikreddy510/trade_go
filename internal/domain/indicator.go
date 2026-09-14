package domain

// IndicatorID names a reusable indicator kind (e.g. EMA, RSI, Supertrend).
// Concrete instances are distinguished by parameters in IndicatorSnapshot.
type IndicatorID string

const (
	IndicatorEMA        IndicatorID = "EMA"
	IndicatorRSI        IndicatorID = "RSI"
	IndicatorSupertrend IndicatorID = "SUPERTREND"
)

// String returns the indicator identifier.
func (id IndicatorID) String() string {
	return string(id)
}

// IndicatorSnapshot holds computed indicator values aligned with market candles.
// Each snapshot is an indicator *instance* (name + parameters), not just a kind.
type IndicatorSnapshot struct {
	Symbol      Symbol
	Timeframe   Timeframe
	Name        IndicatorID
	Parameters  map[string]float64
	Values      []float64
}
