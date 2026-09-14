// Package report creates deterministic, machine-readable trading summaries.
package report

import (
	"sort"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// Summary is an aggregate performance snapshot. Currency is deliberately not
// included because instrument PnL is expressed in the symbol's native units.
type Summary struct {
	GeneratedAt       time.Time       `json:"generated_at"`
	TradeCount        int             `json:"trade_count"`
	OpenTradeCount    int             `json:"open_trade_count"`
	ClosedTradeCount  int             `json:"closed_trade_count"`
	WinningTradeCount int             `json:"winning_trade_count"`
	LosingTradeCount  int             `json:"losing_trade_count"`
	WinRate           float64         `json:"win_rate"`
	RealizedPnL       float64         `json:"realized_pnl"`
	UnrealizedPnL     float64         `json:"unrealized_pnl"`
	NetPnL            float64         `json:"net_pnl"`
	ByStrategy        []StrategyStats `json:"by_strategy"`
}

// StrategyStats is the strategy-level portion of a Summary.
type StrategyStats struct {
	StrategyID       string  `json:"strategy_id"`
	TradeCount       int     `json:"trade_count"`
	OpenTradeCount   int     `json:"open_trade_count"`
	ClosedTradeCount int     `json:"closed_trade_count"`
	RealizedPnL      float64 `json:"realized_pnl"`
	UnrealizedPnL    float64 `json:"unrealized_pnl"`
	NetPnL           float64 `json:"net_pnl"`
}

// Build summarizes all supplied trades at now. Passing now explicitly keeps
// exports reproducible in tests and allows callers to choose their clock.
func Build(trades []domain.Trade, now time.Time) Summary {
	result := Summary{GeneratedAt: now.UTC(), TradeCount: len(trades)}
	byStrategy := make(map[string]*StrategyStats)

	for _, trade := range trades {
		stats := byStrategy[trade.StrategyID]
		if stats == nil {
			stats = &StrategyStats{StrategyID: trade.StrategyID}
			byStrategy[trade.StrategyID] = stats
		}
		stats.TradeCount++

		if trade.State == domain.TradeStateOpen {
			result.OpenTradeCount++
			stats.OpenTradeCount++
			result.UnrealizedPnL += trade.Position.UnrealizedPnL
			stats.UnrealizedPnL += trade.Position.UnrealizedPnL
		}
		if trade.State == domain.TradeStateClosed {
			result.ClosedTradeCount++
			stats.ClosedTradeCount++
			result.RealizedPnL += trade.Position.RealizedPnL
			stats.RealizedPnL += trade.Position.RealizedPnL
			if trade.Position.RealizedPnL > 0 {
				result.WinningTradeCount++
			} else if trade.Position.RealizedPnL < 0 {
				result.LosingTradeCount++
			}
		}
	}

	if result.ClosedTradeCount > 0 {
		result.WinRate = float64(result.WinningTradeCount) / float64(result.ClosedTradeCount)
	}
	result.NetPnL = result.RealizedPnL + result.UnrealizedPnL
	result.ByStrategy = make([]StrategyStats, 0, len(byStrategy))
	for _, stats := range byStrategy {
		stats.NetPnL = stats.RealizedPnL + stats.UnrealizedPnL
		result.ByStrategy = append(result.ByStrategy, *stats)
	}
	sort.Slice(result.ByStrategy, func(i, j int) bool {
		return result.ByStrategy[i].StrategyID < result.ByStrategy[j].StrategyID
	})
	return result
}
