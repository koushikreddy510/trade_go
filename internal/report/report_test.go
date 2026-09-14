package report_test

import (
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/report"
)

func TestBuildAggregatesClosedAndOpenTrades(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	summary := report.Build([]domain.Trade{
		{StrategyID: "alpha", State: domain.TradeStateClosed, Position: domain.Position{RealizedPnL: 25}},
		{StrategyID: "alpha", State: domain.TradeStateClosed, Position: domain.Position{RealizedPnL: -10}},
		{StrategyID: "beta", State: domain.TradeStateOpen, Position: domain.Position{UnrealizedPnL: 4}},
	}, now)

	if summary.TradeCount != 3 || summary.ClosedTradeCount != 2 || summary.OpenTradeCount != 1 {
		t.Fatalf("unexpected counts: %#v", summary)
	}
	if summary.WinningTradeCount != 1 || summary.LosingTradeCount != 1 || summary.WinRate != 0.5 {
		t.Fatalf("unexpected win stats: %#v", summary)
	}
	if summary.RealizedPnL != 15 || summary.UnrealizedPnL != 4 || summary.NetPnL != 19 {
		t.Fatalf("unexpected pnl: %#v", summary)
	}
	if len(summary.ByStrategy) != 2 || summary.ByStrategy[0].StrategyID != "alpha" || summary.ByStrategy[1].StrategyID != "beta" {
		t.Fatalf("strategy summary was not sorted: %#v", summary.ByStrategy)
	}
}
