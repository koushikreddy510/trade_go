package market_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/market"
)

func TestServiceSnapshot1H(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	fp := market.NewSyntheticProvider("26000", 24, start, 70000)
	svc := market.NewService(fp)

	symbol := domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}
	snap, err := svc.Snapshot(context.Background(), symbol, domain.TF1H, 10)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Candles) != 10 {
		t.Fatalf("got %d candles, want 10", len(snap.Candles))
	}
	if snap.Timeframe != domain.TF1H {
		t.Fatalf("timeframe = %s", snap.Timeframe)
	}
}

func TestServiceAggregate2HAnd4H(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	fp := market.NewSyntheticProvider("26000", 32, start, 70000)
	svc := market.NewService(fp)

	symbol := domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}

	snap2H, err := svc.Snapshot(context.Background(), symbol, domain.TF2H, 8)
	if err != nil {
		t.Fatalf("Snapshot 2H: %v", err)
	}
	if len(snap2H.Candles) != 8 {
		t.Fatalf("2H: got %d candles, want 8", len(snap2H.Candles))
	}

	snap4H, err := svc.Snapshot(context.Background(), symbol, domain.TF4H, 4)
	if err != nil {
		t.Fatalf("Snapshot 4H: %v", err)
	}
	if len(snap4H.Candles) != 4 {
		t.Fatalf("4H: got %d candles, want 4", len(snap4H.Candles))
	}
}

func TestServiceMultiSnapshot(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	fp := market.NewSyntheticProvider("26000", 32, start, 70000)
	svc := market.NewService(fp)
	symbol := domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}

	tfs := []domain.Timeframe{domain.TF1H, domain.TF2H, domain.TF4H}
	snaps, err := svc.MultiSnapshot(context.Background(), symbol, tfs, 8)
	if err != nil {
		t.Fatalf("MultiSnapshot: %v", err)
	}
	for _, tf := range tfs {
		if _, ok := snaps[tf]; !ok {
			t.Fatalf("missing snapshot for %s", tf)
		}
	}
}

func TestFixtureProviderJSON(t *testing.T) {
	t.Parallel()

	path := filepath.Join("..", "..", "test", "testdata", "candles_silver_1h.json")
	fp, err := market.NewFixtureProvider(path, "26000")
	if err != nil {
		t.Fatalf("NewFixtureProvider: %v", err)
	}

	symbol := domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"}
	candles, err := fp.FetchCandles(context.Background(), symbol, domain.TF1H, time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("FetchCandles: %v", err)
	}
	if len(candles) < 20 {
		t.Fatalf("expected at least 20 candles, got %d", len(candles))
	}
}

func TestMarketProcessor(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	fp := market.NewSyntheticProvider("26000", 32, start, 70000)
	svc := market.NewService(fp)

	proc, err := market.NewMarketProcessor(market.ProcessorConfig{Service: svc, Lookback: 10})
	if err != nil {
		t.Fatalf("NewMarketProcessor: %v", err)
	}

	ec := &execctx.ExecutionContext{
		Symbol:    domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"},
		Timeframe: domain.TF1H,
		Metadata: map[string]any{
			market.MetadataKeyTimeframes: []string{"1H", "2H", "4H"},
		},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatalf("Process: %v", err)
	}

	if len(ec.Market.Candles) != 10 {
		t.Fatalf("primary market candles = %d, want 10", len(ec.Market.Candles))
	}

	byTF, ok := ec.Metadata[market.MetadataKeyMarketByTF].(map[domain.Timeframe]domain.MarketSnapshot)
	if !ok {
		t.Fatal("market_by_tf not set")
	}
	if len(byTF) != 3 {
		t.Fatalf("market_by_tf has %d entries, want 3", len(byTF))
	}
}

func TestAggregateCandlesPartial(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	candles := []domain.Candle{
		{Time: base, Open: 100, High: 110, Low: 90, Close: 105, Volume: 1000},
		{Time: base.Add(time.Hour), Open: 105, High: 115, Low: 95, Close: 110, Volume: 2000},
		{Time: base.Add(2 * time.Hour), Open: 110, High: 120, Low: 100, Close: 115, Volume: 1500},
	}

	got, err := domain.AggregateCandlesPartial(candles, domain.TF1H, domain.TF2H)
	if err != nil {
		t.Fatalf("AggregateCandlesPartial: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 complete bucket, got %d", len(got))
	}
	if got[0].Open != 100 {
		t.Errorf("Open = %v, want 100", got[0].Open)
	}
}
