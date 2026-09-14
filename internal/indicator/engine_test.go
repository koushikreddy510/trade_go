package indicator_test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/indicator"
)

func sampleCandles(n int) []domain.Candle {
	out := make([]domain.Candle, n)
	price := 100.0
	for i := 0; i < n; i++ {
		price += 0.5
		out[i] = domain.Candle{
			Time:  time.Unix(int64(i+1), 0),
			Open:  price,
			High:  price + 1,
			Low:   price - 1,
			Close: price,
		}
	}
	return out
}

func TestEngineRegistryDedup(t *testing.T) {
	eng := indicator.NewEngine()

	ema1, err := indicator.NewEMA("ema_50", 50)
	if err != nil {
		t.Fatal(err)
	}
	ema2, err := indicator.NewEMA("ema_bias", 50)
	if err != nil {
		t.Fatal(err)
	}

	if err := eng.Register(ema1); err != nil {
		t.Fatal(err)
	}
	if err := eng.Register(ema2); err != nil {
		t.Fatal(err)
	}

	candles := sampleCandles(60)
	snaps, err := eng.ComputeAll(candles)
	if err != nil {
		t.Fatal(err)
	}

	if len(snaps) != 2 {
		t.Fatalf("expected 2 snapshot entries, got %d", len(snaps))
	}
	if snaps["ema_50"].Values[len(snaps["ema_50"].Values)-1] != snaps["ema_bias"].Values[len(snaps["ema_bias"].Values)-1] {
		t.Fatal("deduplicated EMA instances should share values")
	}
}

func TestEngineComputeAll(t *testing.T) {
	eng := indicator.NewEngine()

	indicators := []struct {
		id  string
		new func() (indicator.Indicator, error)
	}{
		{"ema_20", func() (indicator.Indicator, error) { return indicator.NewEMA("ema_20", 20) }},
		{"rsi_14", func() (indicator.Indicator, error) { return indicator.NewRSI("rsi_14", 14) }},
		{"st_lower", func() (indicator.Indicator, error) { return indicator.NewSupertrend("st_lower", 10, 2.0) }},
	}

	for _, spec := range indicators {
		ind, err := spec.new()
		if err != nil {
			t.Fatal(err)
		}
		if err := eng.Register(ind); err != nil {
			t.Fatal(err)
		}
	}

	snaps, err := eng.ComputeAll(sampleCandles(50))
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range indicators {
		snap, ok := snaps[spec.id]
		if !ok {
			t.Fatalf("missing snapshot for %q", spec.id)
		}
		if len(snap.Values) == 0 {
			t.Fatalf("empty values for %q", spec.id)
		}
	}
}

func TestIndicatorProcessorSmoke(t *testing.T) {
	eng := indicator.NewEngine()

	emaInd, err := indicator.NewEMA("ema_10", 10)
	if err != nil {
		t.Fatal(err)
	}
	if err := eng.Register(emaInd); err != nil {
		t.Fatal(err)
	}

	proc := indicator.NewIndicatorProcessor(eng)
	ec := &execctx.ExecutionContext{
		Symbol:    domain.Symbol{Exchange: "MCX", Token: "1", Name: "SILVER"},
		Timeframe: domain.TF1H,
		Market: domain.MarketSnapshot{
			Symbol:    domain.Symbol{Exchange: "MCX", Token: "1", Name: "SILVER"},
			Timeframe: domain.TF1H,
			Candles:   sampleCandles(30),
		},
	}

	if err := proc.Process(context.Background(), ec); err != nil {
		t.Fatal(err)
	}

	snap, ok := ec.Indicators["ema_10"]
	if !ok {
		t.Fatal("processor did not populate indicators")
	}
	if snap.Symbol.Name != "SILVER" || snap.Timeframe != domain.TF1H {
		t.Fatalf("snapshot context not enriched: %+v", snap)
	}
	last := snap.Values[len(snap.Values)-1]
	if math.IsNaN(last) || last == 0 {
		t.Fatalf("unexpected last EMA value %v", last)
	}
}

func TestFactoryConstructors(t *testing.T) {
	cases := []struct {
		name string
		fn   func() (indicator.Indicator, error)
	}{
		{"ema", func() (indicator.Indicator, error) { return indicator.NewEMA("ema_5", 5) }},
		{"rsi", func() (indicator.Indicator, error) { return indicator.NewRSI("rsi_5", 5) }},
		{"supertrend", func() (indicator.Indicator, error) { return indicator.NewSupertrend("st_5", 5, 2) }},
	}
	for _, tc := range cases {
		ind, err := tc.fn()
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if ind.ID() == "" || ind.Name() == "" {
			t.Fatalf("%s: missing id/name", tc.name)
		}
	}
}
