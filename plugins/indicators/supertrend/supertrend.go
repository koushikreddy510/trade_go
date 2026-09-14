package supertrend

import (
	"fmt"
	"math"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// Supertrend computes ATR-based supertrend line and direction.
// Values holds the supertrend line series aligned with candles.
// Parameters includes period, multiplier, and the latest direction (+1 bullish, -1 bearish).
type Supertrend struct {
	id         string
	period     int
	multiplier float64

	prevClose float64
	hasPrev   bool

	trCount  int
	trSum    float64
	atr      float64
	atrReady bool

	prevFinalUpper float64
	prevFinalLower float64
	prevLine       float64
	prevOnUpper    bool
	initialized    bool

	lines      []float64
	directions []float64
}

// New creates a Supertrend indicator instance.
func New(id string, period int, multiplier float64) (*Supertrend, error) {
	if period < 1 {
		return nil, fmt.Errorf("supertrend: period must be >= 1, got %d", period)
	}
	if multiplier <= 0 {
		return nil, fmt.Errorf("supertrend: multiplier must be > 0, got %v", multiplier)
	}
	return &Supertrend{
		id:         id,
		period:     period,
		multiplier: multiplier,
	}, nil
}

func (s *Supertrend) ID() string   { return s.id }
func (s *Supertrend) Name() string { return "supertrend" }

func (s *Supertrend) Warmup() int { return s.period + 1 }

func (s *Supertrend) params() map[string]float64 {
	dir := 0.0
	if len(s.directions) > 0 {
		dir = s.directions[len(s.directions)-1]
	}
	return map[string]float64{
		"period":     float64(s.period),
		"multiplier": s.multiplier,
		"direction":  dir,
	}
}

func (s *Supertrend) Update(c domain.Candle) (domain.IndicatorSnapshot, error) {
	if err := s.apply(c); err != nil {
		return domain.IndicatorSnapshot{}, err
	}
	return s.snapshot(), nil
}

func (s *Supertrend) Compute(candles []domain.Candle) (domain.IndicatorSnapshot, error) {
	s.reset()
	for _, c := range candles {
		if err := s.apply(c); err != nil {
			return domain.IndicatorSnapshot{}, err
		}
	}
	return s.snapshot(), nil
}

func (s *Supertrend) reset() {
	s.prevClose = 0
	s.hasPrev = false
	s.trCount = 0
	s.trSum = 0
	s.atr = 0
	s.atrReady = false
	s.prevFinalUpper = 0
	s.prevFinalLower = 0
	s.prevLine = 0
	s.prevOnUpper = false
	s.initialized = false
	s.lines = s.lines[:0]
	s.directions = s.directions[:0]
}

func (s *Supertrend) apply(c domain.Candle) error {
	if !s.hasPrev {
		s.prevClose = c.Close
		s.hasPrev = true
		s.lines = append(s.lines, 0)
		s.directions = append(s.directions, 0)
		return nil
	}

	// Band ratchet rules must use the *previous* bar close, not the current one.
	prevClose := s.prevClose
	tr := trueRange(c.High, c.Low, prevClose)

	if !s.atrReady {
		s.trSum += tr
		s.trCount++
		s.lines = append(s.lines, 0)
		s.directions = append(s.directions, 0)
		if s.trCount < s.period {
			s.prevClose = c.Close
			return nil
		}
		s.atr = s.trSum / float64(s.period)
		s.atrReady = true
	} else {
		s.atr = (s.atr*float64(s.period-1) + tr) / float64(s.period)
	}

	hl2 := (c.High + c.Low) / 2
	basicUpper := hl2 + s.multiplier*s.atr
	basicLower := hl2 - s.multiplier*s.atr

	finalUpper := basicUpper
	finalLower := basicLower

	if s.initialized {
		if basicUpper < s.prevFinalUpper || prevClose > s.prevFinalUpper {
			finalUpper = basicUpper
		} else {
			finalUpper = s.prevFinalUpper
		}
		if basicLower > s.prevFinalLower || prevClose < s.prevFinalLower {
			finalLower = basicLower
		} else {
			finalLower = s.prevFinalLower
		}
	}

	line, dir, onUpper := s.resolve(c.Close, finalUpper, finalLower)

	if !s.initialized {
		s.initialized = true
		s.lines[len(s.lines)-1] = line
		s.directions[len(s.directions)-1] = dir
	} else {
		s.lines = append(s.lines, line)
		s.directions = append(s.directions, dir)
	}

	s.prevClose = c.Close
	s.prevFinalUpper = finalUpper
	s.prevFinalLower = finalLower
	s.prevLine = line
	s.prevOnUpper = onUpper
	return nil
}

func (s *Supertrend) resolve(close, finalUpper, finalLower float64) (line, direction float64, onUpper bool) {
	if !s.initialized {
		if close <= finalUpper {
			return finalUpper, -1, true
		}
		return finalLower, 1, false
	}

	if s.prevOnUpper {
		if close <= finalUpper {
			return finalUpper, -1, true
		}
		return finalLower, 1, false
	}

	if close >= finalLower {
		return finalLower, 1, false
	}
	return finalUpper, -1, true
}

func trueRange(high, low, prevClose float64) float64 {
	a := high - low
	b := math.Abs(high - prevClose)
	c := math.Abs(low - prevClose)
	return math.Max(a, math.Max(b, c))
}

func (s *Supertrend) snapshot() domain.IndicatorSnapshot {
	vals := make([]float64, len(s.lines))
	copy(vals, s.lines)
	return domain.IndicatorSnapshot{
		Name:       domain.IndicatorSupertrend,
		Parameters: s.params(),
		Values:     vals,
	}
}

// LastDirection returns the latest direction (+1 / -1), or 0 when unavailable.
func (s *Supertrend) LastDirection() float64 {
	if len(s.directions) == 0 {
		return 0
	}
	return s.directions[len(s.directions)-1]
}
