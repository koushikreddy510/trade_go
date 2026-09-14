package trade

import "github.com/koushik-bangaru/atlas/internal/domain"

func realizedPnL(side domain.Side, qty int, entry, exit float64) float64 {
	if qty <= 0 {
		return 0
	}
	switch side {
	case domain.SideBuy:
		return (exit - entry) * float64(qty)
	case domain.SideSell:
		return (entry - exit) * float64(qty)
	default:
		return 0
	}
}

func unrealizedPnL(side domain.Side, qty int, entry, mark float64) float64 {
	return realizedPnL(side, qty, entry, mark)
}
