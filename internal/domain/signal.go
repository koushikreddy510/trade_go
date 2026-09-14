package domain

// Action describes what a strategy wants the trade layer to do with a signal.
type Action string

const (
	ActionBuy    Action = "BUY"
	ActionSell   Action = "SELL"
	ActionExit   Action = "EXIT"
	ActionIgnore Action = "IGNORE"
)

// Signal is produced by a strategy and consumed by the trade manager.
// It carries no broker or execution details.
type Signal struct {
	StrategyID string
	Symbol     Symbol
	Action     Action

	// Confidence is a strategy-local score (0–100). Interpretation is strategy-specific.
	Confidence int

	StopLoss  float64
	Quantity  int
	Metadata  map[string]string
	Timeframes []Timeframe
}
