package ema

import (
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// EMA computes an exponential moving average over close prices.
type EMA struct {
	id     string
	period int
	k      float64

	count  int
	sum    float64
	ema    float64
	seeded bool

	values []float64
}

// New creates an EMA indicator instance.
func New(id string, period int) (*EMA, error) {
	if period < 1 {
		return nil, fmt.Errorf("ema: period must be >= 1, got %d", period)
	}
	return &EMA{
		id:     id,
		period: period,
		k:      2.0 / float64(period+1),
	}, nil
}

func (e *EMA) ID() string   { return e.id }
func (e *EMA) Name() string { return "ema" }

func (e *EMA) Warmup() int { return e.period }

func (e *EMA) params() map[string]float64 {
	return map[string]float64{"period": float64(e.period)}
}

func (e *EMA) Update(c domain.Candle) (domain.IndicatorSnapshot, error) {
	if err := e.apply(c.Close); err != nil {
		return domain.IndicatorSnapshot{}, err
	}
	return e.snapshot(), nil
}

func (e *EMA) Compute(candles []domain.Candle) (domain.IndicatorSnapshot, error) {
	e.reset()
	for _, c := range candles {
		if err := e.apply(c.Close); err != nil {
			return domain.IndicatorSnapshot{}, err
		}
	}
	return e.snapshot(), nil
}

func (e *EMA) reset() {
	e.count = 0
	e.sum = 0
	e.ema = 0
	e.seeded = false
	e.values = e.values[:0]
}

func (e *EMA) apply(close float64) error {
	e.count++
	if !e.seeded {
		e.sum += close
		if e.count < e.period {
			e.values = append(e.values, 0)
			return nil
		}
		e.ema = e.sum / float64(e.period)
		e.seeded = true
		e.values = append(e.values, e.ema)
		return nil
	}

	e.ema = close*e.k + e.ema*(1-e.k)
	e.values = append(e.values, e.ema)
	return nil
}

func (e *EMA) snapshot() domain.IndicatorSnapshot {
	vals := make([]float64, len(e.values))
	copy(vals, e.values)
	return domain.IndicatorSnapshot{
		Name:       domain.IndicatorEMA,
		Parameters: e.params(),
		Values:     vals,
	}
}
