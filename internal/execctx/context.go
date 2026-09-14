// Package execctx holds the execution context passed through the processor pipeline.
// The package name avoids conflicting with the standard library context package.
package execctx

import (
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// ExecutionContext is the single immutable input object for pipeline processors.
// The workflow engine builds it once per run; processors enrich derived outputs
// (signals, trades) without mutating upstream snapshots.
type ExecutionContext struct {
	WorkflowID    string
	ConfigVersion int
	Symbol        domain.Symbol
	Timeframe     domain.Timeframe
	ExecutionMode domain.ExecutionMode
	Timestamp     time.Time

	Market     domain.MarketSnapshot
	Indicators map[string]domain.IndicatorSnapshot
	Features   map[string]any
	Signals    []domain.Signal
	Trades     []domain.Trade
	Metadata   map[string]any
}
