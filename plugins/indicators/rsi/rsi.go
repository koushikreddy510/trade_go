package rsi

import (
	"fmt"
	"math"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// RSI computes the Relative Strength Index using Wilder smoothing.
type RSI struct {
	id     string
	period int

	prevClose float64
	hasPrev   bool

	count    int
	gainSum  float64
	lossSum  float64
	avgGain  float64
	avgLoss  float64
	seeded   bool

	values []float64
}

// New creates an RSI indicator instance.
func New(id string, period int) (*RSI, error) {
	if period < 1 {
		return nil, fmt.Errorf("rsi: period must be >= 1, got %d", period)
	}
	return &RSI{id: id, period: period}, nil
}

func (r *RSI) ID() string   { return r.id }
func (r *RSI) Name() string { return "rsi" }

func (r *RSI) Warmup() int { return r.period + 1 }

func (r *RSI) params() map[string]float64 {
	return map[string]float64{"period": float64(r.period)}
}

func (r *RSI) Update(c domain.Candle) (domain.IndicatorSnapshot, error) {
	if err := r.apply(c.Close); err != nil {
		return domain.IndicatorSnapshot{}, err
	}
	return r.snapshot(), nil
}

func (r *RSI) Compute(candles []domain.Candle) (domain.IndicatorSnapshot, error) {
	r.reset()
	for _, c := range candles {
		if err := r.apply(c.Close); err != nil {
			return domain.IndicatorSnapshot{}, err
		}
	}
	return r.snapshot(), nil
}

func (r *RSI) reset() {
	r.prevClose = 0
	r.hasPrev = false
	r.count = 0
	r.gainSum = 0
	r.lossSum = 0
	r.avgGain = 0
	r.avgLoss = 0
	r.seeded = false
	r.values = r.values[:0]
}

func (r *RSI) apply(close float64) error {
	if !r.hasPrev {
		r.prevClose = close
		r.hasPrev = true
		r.values = append(r.values, 0)
		return nil
	}

	change := close - r.prevClose
	r.prevClose = close

	gain, loss := 0.0, 0.0
	if change > 0 {
		gain = change
	} else {
		loss = -change
	}

	if !r.seeded {
		r.gainSum += gain
		r.lossSum += loss
		r.count++
		r.values = append(r.values, 0)
		if r.count < r.period {
			return nil
		}
		r.avgGain = r.gainSum / float64(r.period)
		r.avgLoss = r.lossSum / float64(r.period)
		r.seeded = true
		r.values[len(r.values)-1] = r.calcRSI()
		return nil
	}

	r.avgGain = (r.avgGain*float64(r.period-1) + gain) / float64(r.period)
	r.avgLoss = (r.avgLoss*float64(r.period-1) + loss) / float64(r.period)
	r.values = append(r.values, r.calcRSI())
	return nil
}

func (r *RSI) calcRSI() float64 {
	if r.avgLoss == 0 {
		if r.avgGain == 0 {
			return 0
		}
		return 100
	}
	rs := r.avgGain / r.avgLoss
	return 100 - (100 / (1 + rs))
}

func (r *RSI) snapshot() domain.IndicatorSnapshot {
	vals := make([]float64, len(r.values))
	copy(vals, r.values)
	return domain.IndicatorSnapshot{
		Name:       domain.IndicatorRSI,
		Parameters: r.params(),
		Values:     vals,
	}
}

// Last returns the most recent RSI value, or NaN when unavailable.
func (r *RSI) Last() float64 {
	if len(r.values) == 0 {
		return math.NaN()
	}
	return r.values[len(r.values)-1]
}
