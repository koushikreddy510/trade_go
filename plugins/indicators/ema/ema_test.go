package ema_test

import (
	"math"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/plugins/indicators/ema"
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

func TestEMAComputeLastValue(t *testing.T) {
	ind, err := ema.New("ema_3", 3)
	if err != nil {
		t.Fatal(err)
	}

	closes := []float64{10, 11, 12, 13, 14, 15}
	snap, err := ind.Compute(makeCandles(closes))
	if err != nil {
		t.Fatal(err)
	}

	want := 14.0
	got := snap.Values[len(snap.Values)-1]
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("last EMA = %v, want %v", got, want)
	}
}

func TestEMAUpdateMatchesCompute(t *testing.T) {
	closes := []float64{10, 11, 12, 13, 14, 15}

	full, err := ema.New("ema_3", 3)
	if err != nil {
		t.Fatal(err)
	}
	fullSnap, err := full.Compute(makeCandles(closes))
	if err != nil {
		t.Fatal(err)
	}

	inc, err := ema.New("ema_3", 3)
	if err != nil {
		t.Fatal(err)
	}
	var incSnap domain.IndicatorSnapshot
	for _, c := range makeCandles(closes) {
		incSnap, err = inc.Update(c)
		if err != nil {
			t.Fatal(err)
		}
	}

	if len(incSnap.Values) != len(fullSnap.Values) {
		t.Fatalf("length mismatch: update %d compute %d", len(incSnap.Values), len(fullSnap.Values))
	}
	for i := range fullSnap.Values {
		if math.Abs(incSnap.Values[i]-fullSnap.Values[i]) > 1e-9 {
			t.Fatalf("bar %d: update %v compute %v", i, incSnap.Values[i], fullSnap.Values[i])
		}
	}
}

func TestEMAWarmup(t *testing.T) {
	ind, err := ema.New("ema_5", 5)
	if err != nil {
		t.Fatal(err)
	}
	if ind.Warmup() != 5 {
		t.Fatalf("warmup = %d, want 5", ind.Warmup())
	}
}
