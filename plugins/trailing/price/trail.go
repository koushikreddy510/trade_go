// Package price implements absolute price-distance trailing stop policies.
package price

import (
	"math"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/trailing"
)

// PriceTrail trails stop-loss by a fixed absolute price distance from close.
type PriceTrail struct {
	TrailPoints float64
}

// Name returns the policy identifier.
func (p PriceTrail) Name() string {
	return "price_trail"
}

// NextStopLoss returns an updated stop when price moves favorably.
// For BUY: newSL = max(currentSL, close - trailDistance, ema when provided).
// For SELL: newSL = min(currentSL, close + trailDistance, ema when provided).
func (p PriceTrail) NextStopLoss(trade domain.Trade, close float64, ema float64) (float64, bool) {
	if p.TrailPoints <= 0 || close <= 0 {
		return trade.Risk.StopLoss, false
	}

	current := trade.Risk.StopLoss
	if current <= 0 {
		return current, false
	}

	switch trade.Side {
	case domain.SideBuy:
		candidate := close - p.TrailPoints
		if ema > 0 && ema > candidate {
			candidate = ema
		}
		newSL := math.Max(current, candidate)
		if newSL > current {
			return newSL, true
		}
	case domain.SideSell:
		candidate := close + p.TrailPoints
		if ema > 0 && ema < candidate {
			candidate = ema
		}
		newSL := math.Min(current, candidate)
		if newSL < current {
			return newSL, true
		}
	}

	return current, false
}

var _ trailing.Policy = PriceTrail{}
