package domain

import (
	"testing"
	"time"
)

func TestParseTimeframe(t *testing.T) {
	tests := []struct {
		input   string
		want    Timeframe
		wantErr bool
	}{
		{"1H", TF1H, false},
		{"1h", TF1H, false},
		{" 2H ", TF2H, false},
		{"4H", TF4H, false},
		{"5H", 0, true},
		{"", 0, true},
	}

	for _, tt := range tests {
		got, err := ParseTimeframe(tt.input)
		if tt.wantErr {
			if err == nil {
				t.Errorf("ParseTimeframe(%q) expected error", tt.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseTimeframe(%q) unexpected error: %v", tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("ParseTimeframe(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestTimeframeDurationAndMinutes(t *testing.T) {
	if TF1H.Minutes() != 60 || TF1H.Duration() != time.Hour {
		t.Errorf("TF1H: minutes=%d duration=%v", TF1H.Minutes(), TF1H.Duration())
	}
	if TF2H.Minutes() != 120 || TF2H.Duration() != 2*time.Hour {
		t.Errorf("TF2H: minutes=%d duration=%v", TF2H.Minutes(), TF2H.Duration())
	}
	if TF4H.Minutes() != 240 || TF4H.Duration() != 4*time.Hour {
		t.Errorf("TF4H: minutes=%d duration=%v", TF4H.Minutes(), TF4H.Duration())
	}
}

func TestAggregateCandles1HTo2H(t *testing.T) {
	base := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	candles := []Candle{
		{Time: base, Open: 100, High: 110, Low: 90, Close: 105, Volume: 1000},
		{Time: base.Add(time.Hour), Open: 105, High: 115, Low: 95, Close: 110, Volume: 2000},
	}

	got, err := AggregateCandles(candles, TF1H, TF2H)
	if err != nil {
		t.Fatalf("AggregateCandles: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 aggregated candle, got %d", len(got))
	}

	agg := got[0]
	if agg.Time != base {
		t.Errorf("Time = %v, want %v", agg.Time, base)
	}
	if agg.Open != 100 {
		t.Errorf("Open = %v, want 100", agg.Open)
	}
	if agg.High != 115 {
		t.Errorf("High = %v, want 115", agg.High)
	}
	if agg.Low != 90 {
		t.Errorf("Low = %v, want 90", agg.Low)
	}
	if agg.Close != 110 {
		t.Errorf("Close = %v, want 110", agg.Close)
	}
	if agg.Volume != 3000 {
		t.Errorf("Volume = %v, want 3000", agg.Volume)
	}
}

func TestAggregateCandlesOI(t *testing.T) {
	base := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	oi1 := int64(500)
	oi2 := int64(600)
	candles := []Candle{
		{Time: base, Open: 100, High: 110, Low: 90, Close: 105, Volume: 1000, OI: &oi1},
		{Time: base.Add(time.Hour), Open: 105, High: 115, Low: 95, Close: 110, Volume: 2000, OI: &oi2},
	}

	got, err := AggregateCandles(candles, TF1H, TF2H)
	if err != nil {
		t.Fatalf("AggregateCandles: %v", err)
	}
	if got[0].OI == nil || *got[0].OI != 600 {
		t.Errorf("OI = %v, want 600", got[0].OI)
	}
}

func TestAggregateCandlesInvalidRatio(t *testing.T) {
	base := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	candles := []Candle{
		{Time: base, Open: 100, High: 110, Low: 90, Close: 105, Volume: 1000},
	}

	_, err := AggregateCandles(candles, TF1H, TF2H)
	if err == nil {
		t.Fatal("expected error for incomplete bucket")
	}
}
