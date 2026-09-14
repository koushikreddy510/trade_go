package supertrend_test

import (
	"math"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/plugins/indicators/supertrend"
)

func makeTrendCandles(n int) []domain.Candle {
	out := make([]domain.Candle, n)
	price := 100.0
	for i := 0; i < n; i++ {
		if i%5 < 3 {
			price += 1.5
		} else {
			price -= 0.5
		}
		out[i] = domain.Candle{
			Time:  time.Unix(int64(i+1), 0),
			Open:  price - 0.5,
			High:  price + 1.0,
			Low:   price - 1.0,
			Close: price,
		}
	}
	return out
}

func TestSupertrendProducesLineAndDirection(t *testing.T) {
	ind, err := supertrend.New("st_10", 10, 3.0)
	if err != nil {
		t.Fatal(err)
	}

	snap, err := ind.Compute(makeTrendCandles(40))
	if err != nil {
		t.Fatal(err)
	}

	line := snap.Values[len(snap.Values)-1]
	dir := snap.Parameters["direction"]
	if line == 0 || math.IsNaN(line) || math.IsInf(line, 0) {
		t.Fatalf("expected finite supertrend line, got %v", line)
	}
	if dir != 1 && dir != -1 {
		t.Fatalf("direction = %v, want +1 or -1", dir)
	}
}

func TestSupertrendUpdateMatchesCompute(t *testing.T) {
	candles := makeTrendCandles(25)

	full, err := supertrend.New("st_5", 5, 2.0)
	if err != nil {
		t.Fatal(err)
	}
	fullSnap, err := full.Compute(candles)
	if err != nil {
		t.Fatal(err)
	}

	inc, err := supertrend.New("st_5", 5, 2.0)
	if err != nil {
		t.Fatal(err)
	}
	var incSnap domain.IndicatorSnapshot
	for _, c := range candles {
		incSnap, err = inc.Update(c)
		if err != nil {
			t.Fatal(err)
		}
	}

	if len(incSnap.Values) != len(fullSnap.Values) {
		t.Fatalf("length mismatch: update %d compute %d", len(incSnap.Values), len(fullSnap.Values))
	}
	last := len(fullSnap.Values) - 1
	if math.Abs(incSnap.Values[last]-fullSnap.Values[last]) > 1e-9 {
		t.Fatalf("last line update %v compute %v", incSnap.Values[last], fullSnap.Values[last])
	}
	if incSnap.Parameters["direction"] != fullSnap.Parameters["direction"] {
		t.Fatalf("direction update %v compute %v", incSnap.Parameters["direction"], fullSnap.Parameters["direction"])
	}
}

func TestSupertrendBullTrendDirection(t *testing.T) {
	ind, err := supertrend.New("st_7", 7, 2.0)
	if err != nil {
		t.Fatal(err)
	}
	candles := make([]domain.Candle, 60)
	for i := range candles {
		o := 1000 + float64(i)*10
		candles[i] = domain.Candle{
			Time:  time.Unix(int64(i+1)*3600, 0),
			Open:  o,
			High:  o + 3,
			Low:   o - 1,
			Close: o + 2,
		}
	}
	snap, err := ind.Compute(candles)
	if err != nil {
		t.Fatal(err)
	}
	if dir := snap.Parameters["direction"]; dir != 1 {
		t.Fatalf("bull trend direction = %v, want +1", dir)
	}
}

func TestSupertrendWarmup(t *testing.T) {
	ind, err := supertrend.New("st_10", 10, 2.0)
	if err != nil {
		t.Fatal(err)
	}
	if ind.Warmup() != 11 {
		t.Fatalf("warmup = %d, want 11", ind.Warmup())
	}
}
