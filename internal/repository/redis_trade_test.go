package repository_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/repository"
)

func TestRedisTradeRepositoryRoundtrip(t *testing.T) {
	t.Parallel()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	client := repository.NewRedisClient(mr.Addr(), 0)
	repo := repository.NewRedisTradeRepository(client)
	ctx := context.Background()

	open := sampleTrade("trade-1", domain.TradeStateOpen)
	if err := repo.Save(ctx, open); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if !mr.Exists("atlas:trade:trade-1") {
		t.Fatal("expected trade key in redis")
	}
	members, err := mr.ZMembers("atlas:trade:active")
	if err != nil {
		t.Fatalf("ZMembers: %v", err)
	}
	if !slices.Contains(members, "trade-1") {
		t.Fatal("expected active zset member")
	}
	if !mr.Exists("atlas:position:ema:MCX:26000") {
		t.Fatal("expected position key in redis")
	}

	found, err := repo.Find(ctx, "trade-1")
	if err != nil {
		t.Fatalf("Find: %v", err)
	}
	if found.TradeID != open.TradeID {
		t.Fatalf("trade id = %s", found.TradeID)
	}

	active, err := repo.Active(ctx)
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if len(active) != 1 {
		t.Fatalf("active = %d, want 1", len(active))
	}

	open.State = domain.TradeStateClosed
	open.Position.Quantity = 0
	if err := repo.Update(ctx, open); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := repo.DeleteActive(ctx, "trade-1"); err != nil {
		t.Fatalf("DeleteActive: %v", err)
	}

	members, err = mr.ZMembers("atlas:trade:active")
	if err == nil && slices.Contains(members, "trade-1") {
		t.Fatal("expected trade removed from active zset")
	}
	if mr.Exists("atlas:position:ema:MCX:26000") {
		t.Fatal("expected position key removed")
	}
}

func TestRedisPing(t *testing.T) {
	t.Parallel()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	client := repository.NewRedisClient(mr.Addr(), 0)
	if err := repository.Ping(context.Background(), client); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestRedisTokenStore(t *testing.T) {
	t.Parallel()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	client := repository.NewRedisClient(mr.Addr(), 0)
	store := repository.NewRedisTokenStore(client)
	ctx := context.Background()
	key := repository.FlattradeTokenKey()

	if err := store.Set(ctx, key, "jkey-123", time.Hour); err != nil {
		t.Fatalf("Set: %v", err)
	}

	got, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != "jkey-123" {
		t.Fatalf("token = %q, want jkey-123", got)
	}
}

func TestMemoryTokenStore(t *testing.T) {
	t.Parallel()

	store := repository.NewMemoryTokenStore()
	ctx := context.Background()
	key := repository.FlattradeTokenKey()

	if err := store.Set(ctx, key, "jkey-abc", time.Hour); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != "jkey-abc" {
		t.Fatalf("token = %q", got)
	}

	short := repository.NewMemoryTokenStore()
	if err := short.Set(ctx, key, "expired", time.Millisecond); err != nil {
		t.Fatalf("Set short: %v", err)
	}
	time.Sleep(2 * time.Millisecond)
	if _, err := short.Get(ctx, key); err != repository.ErrTokenNotFound {
		t.Fatalf("Get expired err = %v, want ErrTokenNotFound", err)
	}
}
