package rsi_test

import (
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/plugins/indicators/rsi"
)

func makeCandles(closes []float64) []domain.Candle {
	out := make([]domain.Candle, len(closes))
	for i, c := range closes {
		out[i] = domain.Candle{
			Time:  time.Unix(int64(i+1), 0),
			Close: c,
			Open:  c,
			High:  c,
			Low:   c,
		}
	}
	return out
}

func TestRSIRisingSeriesHigh(t *testing.T) {
	ind, err := rsi.New("rsi_2", 2)
	if err != nil {
		t.Fatal(err)
	}

	closes := []float64{10, 12, 14, 16, 18}
	snap, err := ind.Compute(makeCandles(closes))
	if err != nil {
		t.Fatal(err)
	}

	last := snap.Values[len(snap.Values)-1]
	if last < 90 {
		t.Fatalf("rising series RSI = %v, want high (>90)", last)
	}
}

func TestRSIMixedSeriesLower(t *testing.T) {
	ind, err := rsi.New("rsi_3", 3)
	if err != nil {
		t.Fatal(err)
	}

	closes := []float64{10, 12, 11, 10, 9, 8, 9, 10}
	snap, err := ind.Compute(makeCandles(closes))
	if err != nil {
		t.Fatal(err)
	}

	rising, err := rsi.New("rsi_3", 3)
	if err != nil {
		t.Fatal(err)
	}
	risingSnap, err := rising.Compute(makeCandles([]float64{10, 12, 14, 16, 18, 20, 22}))
	if err != nil {
		t.Fatal(err)
	}

	mixed := snap.Values[len(snap.Values)-1]
	up := risingSnap.Values[len(risingSnap.Values)-1]
	if mixed >= up {
		t.Fatalf("mixed RSI %v should be lower than rising RSI %v", mixed, up)
	}
}

func TestRSIWarmup(t *testing.T) {
	ind, err := rsi.New("rsi_14", 14)
	if err != nil {
		t.Fatal(err)
	}
	if ind.Warmup() != 15 {
		t.Fatalf("warmup = %d, want 15", ind.Warmup())
	}
}
