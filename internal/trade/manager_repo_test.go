package trade_test

import (
	"context"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/repository"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

func TestManagerOpenTradePersists(t *testing.T) {
	t.Parallel()

	repo := repository.NewMemoryTradeRepository()
	mgr := trade.NewManager(trade.WithRepository(repo))
	ctx := context.Background()
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)

	opened, err := mgr.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 2, 99500), 100000, now)
	if err != nil {
		t.Fatalf("OpenTrade: %v", err)
	}

	stored, err := repo.Find(ctx, opened.TradeID)
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if stored.State != domain.TradeStateOpen {
		t.Fatalf("stored state = %s, want OPEN", stored.State)
	}

	active, err := repo.Active(ctx)
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active in repo = %d, want 1", len(active))
	}
}

func TestManagerLoadActiveFromRepo(t *testing.T) {
	t.Parallel()

	repo := repository.NewMemoryTradeRepository()
	ctx := context.Background()
	now := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)

	seed := trade.NewManager(trade.WithRepository(repo))
	if _, err := seed.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 1, 99500), 100000, now); err != nil {
		t.Fatalf("seed open: %v", err)
	}

	restored := trade.NewManager(trade.WithRepository(repo))
	if err := restored.LoadActiveFromRepo(ctx); err != nil {
		t.Fatalf("LoadActiveFromRepo: %v", err)
	}

	active := restored.GetActive()
	if len(active) != 1 {
		t.Fatalf("restored active = %d, want 1", len(active))
	}
	if active[0].StrategyID != "ema" {
		t.Fatalf("strategy = %s", active[0].StrategyID)
	}

	opened, err := restored.OpenTrade(ctx, "wf-2", 1, buySignal("breakout", 1, 99400), 100500, now)
	if err != nil {
		t.Fatalf("second open after restore: %v", err)
	}
	if opened.TradeID != "trade-2" {
		t.Fatalf("trade id = %s, want trade-2", opened.TradeID)
	}
}

func TestManagerCloseTradeUpdatesRepo(t *testing.T) {
	t.Parallel()

	repo := repository.NewMemoryTradeRepository()
	mgr := trade.NewManager(trade.WithRepository(repo))
	ctx := context.Background()
	now := time.Now().UTC()

	opened, err := mgr.OpenTrade(ctx, "wf-1", 1, buySignal("ema", 1, 99500), 100000, now)
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	if _, err := mgr.CloseTrade(ctx, opened.TradeID, 101000, now); err != nil {
		t.Fatalf("close: %v", err)
	}

	active, err := repo.Active(ctx)
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(active) != 0 {
		t.Fatalf("active after close = %d, want 0", len(active))
	}

	stored, err := repo.Find(ctx, opened.TradeID)
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if stored.State != domain.TradeStateClosed {
		t.Fatalf("stored state = %s, want CLOSED", stored.State)
	}
}
