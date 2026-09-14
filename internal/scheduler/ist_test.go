package scheduler

import (
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

func istTime(year int, month time.Month, day, hour, min int) time.Time {
	return time.Date(year, month, day, hour, min, 0, 0, IST)
}

func TestIsCandleCloseBoundary(t *testing.T) {
	tests := []struct {
		name string
		tf   domain.Timeframe
		at   time.Time
		want bool
	}{
		{"1H top of hour", domain.TF1H, istTime(2026, 8, 1, 11, 0), true},
		{"1H odd hour", domain.TF1H, istTime(2026, 8, 1, 11, 30), false},
		{"2H even hour", domain.TF2H, istTime(2026, 8, 1, 12, 0), true},
		{"2H odd hour", domain.TF2H, istTime(2026, 8, 1, 11, 0), false},
		{"4H aligned", domain.TF4H, istTime(2026, 8, 1, 16, 0), true},
		{"4H misaligned", domain.TF4H, istTime(2026, 8, 1, 14, 0), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsCandleCloseBoundary(tt.tf, tt.at); got != tt.want {
				t.Fatalf("IsCandleCloseBoundary(%s, %v) = %v, want %v", tt.tf, tt.at, got, tt.want)
			}
		})
	}
}

func TestNextCandleCloseAfter_1H(t *testing.T) {
	after := istTime(2026, 8, 1, 10, 30)
	got := NextCandleCloseAfter(domain.TF1H, after)
	want := istTime(2026, 8, 1, 11, 0)
	if !got.Equal(want) {
		t.Fatalf("NextCandleCloseAfter(1H, 10:30) = %v, want %v", got, want)
	}

	exact := istTime(2026, 8, 1, 11, 0)
	got = NextCandleCloseAfter(domain.TF1H, exact)
	want = istTime(2026, 8, 1, 12, 0)
	if !got.Equal(want) {
		t.Fatalf("NextCandleCloseAfter(1H, 11:00) = %v, want %v", got, want)
	}
}

func TestNextCandleCloseAfter_2H(t *testing.T) {
	after := istTime(2026, 8, 1, 10, 30)
	got := NextCandleCloseAfter(domain.TF2H, after)
	want := istTime(2026, 8, 1, 12, 0)
	if !got.Equal(want) {
		t.Fatalf("NextCandleCloseAfter(2H, 10:30) = %v, want %v", got, want)
	}

	afterEven := istTime(2026, 8, 1, 12, 0)
	got = NextCandleCloseAfter(domain.TF2H, afterEven)
	want = istTime(2026, 8, 1, 14, 0)
	if !got.Equal(want) {
		t.Fatalf("NextCandleCloseAfter(2H, 12:00) = %v, want %v", got, want)
	}
}

func TestNextCandleCloseAfter_4H(t *testing.T) {
	after := istTime(2026, 8, 1, 10, 30)
	got := NextCandleCloseAfter(domain.TF4H, after)
	want := istTime(2026, 8, 1, 12, 0)
	if !got.Equal(want) {
		t.Fatalf("NextCandleCloseAfter(4H, 10:30) = %v, want %v", got, want)
	}

	afterAligned := istTime(2026, 8, 1, 12, 0)
	got = NextCandleCloseAfter(domain.TF4H, afterAligned)
	want = istTime(2026, 8, 1, 16, 0)
	if !got.Equal(want) {
		t.Fatalf("NextCandleCloseAfter(4H, 12:00) = %v, want %v", got, want)
	}
}

func TestNextCandleCloseOnOrAfter_includesCurrentBoundary(t *testing.T) {
	at := istTime(2026, 8, 1, 12, 0)
	got := NextCandleCloseOnOrAfter(domain.TF2H, at)
	if !got.Equal(at) {
		t.Fatalf("NextCandleCloseOnOrAfter(2H, 12:00) = %v, want %v", got, at)
	}
}

func TestISTAlignmentFromUTC(t *testing.T) {
	// 06:30 UTC = 12:00 IST
	utc := time.Date(2026, 8, 1, 6, 30, 0, 0, time.UTC)
	if !IsCandleCloseBoundary(domain.TF2H, utc) {
		t.Fatal("expected 06:30 UTC to be 2H boundary in IST")
	}
}
