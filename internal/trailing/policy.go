// Package trailing defines stop-loss trailing policies and pipeline processing.
package trailing

import "github.com/koushik-bangaru/atlas/internal/domain"

// Policy evaluates a candidate stop-loss level for an open trade.
type Policy interface {
	Name() string
	NextStopLoss(trade domain.Trade, close float64, ema float64) (newSL float64, changed bool)
}
