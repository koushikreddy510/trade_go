package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/repository"
)

func sampleTrade(id string, state domain.TradeState) *domain.Trade {
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	return &domain.Trade{
		TradeID:       id,
		WorkflowID:    "wf-1",
		StrategyID:    "ema",
		ConfigVersion: 1,
		Symbol: domain.Symbol{
			Exchange: "MCX",
			Token:    "26000",
			Name:     "SILVERM",
			LotSize:  1,
		},
		Side:     domain.SideBuy,
		Quantity: 2,
		State:    state,
		Position: domain.Position{
			AvgPrice:  100000,
			Quantity:  2,
			EntryTime: now,
		},
		Risk: domain.RiskState{
			StopLoss: 99500,
			Target:   101500,
		},
		Metadata: map[string]string{"source": "test"},
	}
}

func TestMemoryTradeRepositoryRoundtrip(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	repo := repository.NewMemoryTradeRepository()
	open := sampleTrade("trade-1", domain.TradeStateOpen)

	if err := repo.Save(ctx, open); err != nil {
		t.Fatalf("Save: %v", err)
	}

	found, err := repo.Find(ctx, "trade-1")
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if found.TradeID != open.TradeID || found.Risk.StopLoss != open.Risk.StopLoss {
		t.Fatalf("Find mismatch: %+v", found)
	}

	active, err := repo.Active(ctx)
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active count = %d, want 1", len(active))
	}

	byStrategy, err := repo.ByStrategy(ctx, "ema")
	if err != nil {
		t.Fatalf("ByStrategy: %v", err)
	}
	if len(byStrategy) != 1 {
		t.Fatalf("strategy trades = %d, want 1", len(byStrategy))
	}

	open.State = domain.TradeStateClosed
	open.Position.Quantity = 0
	open.Position.RealizedPnL = 1000
	if err := repo.Update(ctx, open); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := repo.DeleteActive(ctx, "trade-1"); err != nil {
		t.Fatalf("DeleteActive: %v", err)
	}

	active, err = repo.Active(ctx)
	if err != nil {
		t.Fatalf("Active after close: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("active after close = %d, want 0", len(active))
	}

	closed, err := repo.Find(ctx, "trade-1")
	if err != nil {
		t.Fatalf("Find closed: %v", err)
	}
	if closed.State != domain.TradeStateClosed {
		t.Fatalf("state = %s, want CLOSED", closed.State)
	}
}

func TestKeyHelpers(t *testing.T) {
	t.Parallel()

	if got := repository.TradeKey("trade-1"); got != "atlas:trade:trade-1" {
		t.Fatalf("TradeKey = %q", got)
	}
	if got := repository.ActiveTradesKey(); got != "atlas:trade:active" {
		t.Fatalf("ActiveTradesKey = %q", got)
	}
	if got := repository.StrategyTradesKey("ema"); got != "atlas:strategy:ema:trades" {
		t.Fatalf("StrategyTradesKey = %q", got)
	}
	if got := repository.PositionKey("ema", "MCX", "26000"); got != "atlas:position:ema:MCX:26000" {
		t.Fatalf("PositionKey = %q", got)
	}
	if got := repository.FlattradeTokenKey(); got != "atlas:broker:flattrade:token" {
		t.Fatalf("FlattradeTokenKey = %q", got)
	}
}
