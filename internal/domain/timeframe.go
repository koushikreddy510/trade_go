package domain

import (
	"fmt"
	"strings"
	"time"
)

// Timeframe represents a candle bar duration used across market data,
// indicators, and strategies. Atlas V1 supports 1H, 2H, and 4H bars.
type Timeframe int

const (
	// TF1H is a one-hour candle interval (60 minutes).
	TF1H Timeframe = 1

	// TF2H is a two-hour candle interval (120 minutes).
	TF2H Timeframe = 2

	// TF4H is a four-hour candle interval (240 minutes).
	TF4H Timeframe = 4
)

// ParseTimeframe converts a string such as "1H", "2h", or "4H" into a Timeframe.
func ParseTimeframe(s string) (Timeframe, error) {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case "1H":
		return TF1H, nil
	case "2H":
		return TF2H, nil
	case "4H":
		return TF4H, nil
	default:
		return 0, fmt.Errorf("domain: unknown timeframe %q", s)
	}
}

// String returns the canonical uppercase label (e.g. "1H").
func (tf Timeframe) String() string {
	switch tf {
	case TF1H:
		return "1H"
	case TF2H:
		return "2H"
	case TF4H:
		return "4H"
	default:
		return fmt.Sprintf("TF(%d)", int(tf))
	}
}

// Minutes returns the bar duration in minutes.
func (tf Timeframe) Minutes() int {
	switch tf {
	case TF1H:
		return 60
	case TF2H:
		return 120
	case TF4H:
		return 240
	default:
		return 0
	}
}

// Duration returns the bar duration as a time.Duration.
func (tf Timeframe) Duration() time.Duration {
	return time.Duration(tf.Minutes()) * time.Minute
}

// AggregateCandles combines lower-timeframe candles into higher-timeframe bars.
// source must be strictly smaller than target, and target must be an integer
// multiple of source (e.g. 1H→2H, 1H→4H, 2H→4H).
//
// Candles are grouped by target bucket start (time truncated to target duration).
// OHLCV rules: Open from first bar, High=max, Low=min, Close from last bar,
// Volume summed. OI, when present, is taken from the last bar in the bucket.
func AggregateCandles(candles []Candle, source, target Timeframe) ([]Candle, error) {
	srcMin := source.Minutes()
	tgtMin := target.Minutes()
	if srcMin == 0 || tgtMin == 0 {
		return nil, fmt.Errorf("domain: invalid timeframe source=%s target=%s", source, target)
	}
	if tgtMin <= srcMin {
		return nil, fmt.Errorf("domain: target %s must be larger than source %s", target, source)
	}
	if tgtMin%srcMin != 0 {
		return nil, fmt.Errorf("domain: target %s is not a multiple of source %s", target, source)
	}

	ratio := tgtMin / srcMin
	tgtDur := target.Duration()

	type bucket struct {
		start time.Time
		bars  []Candle
	}
	buckets := make(map[int64]*bucket)
	order := make([]int64, 0)

	for _, c := range candles {
		start := c.Time.Truncate(tgtDur)
		key := start.Unix()
		b, ok := buckets[key]
		if !ok {
			b = &bucket{start: start}
			buckets[key] = b
			order = append(order, key)
		}
		b.bars = append(b.bars, c)
	}

	out := make([]Candle, 0, len(order))
	for _, key := range order {
		b := buckets[key]
		if len(b.bars) != ratio {
			return nil, fmt.Errorf("domain: bucket %s has %d candles, expected %d", b.start, len(b.bars), ratio)
		}
		out = append(out, aggregateBucket(b.bars, b.start))
	}

	return out, nil
}

// AggregateCandlesPartial combines lower-timeframe candles into higher-timeframe bars,
// skipping buckets that do not contain exactly ratio source bars (incomplete trailing buckets).
func AggregateCandlesPartial(candles []Candle, source, target Timeframe) ([]Candle, error) {
	srcMin := source.Minutes()
	tgtMin := target.Minutes()
	if srcMin == 0 || tgtMin == 0 {
		return nil, fmt.Errorf("domain: invalid timeframe source=%s target=%s", source, target)
	}
	if tgtMin <= srcMin {
		return nil, fmt.Errorf("domain: target %s must be larger than source %s", target, source)
	}
	if tgtMin%srcMin != 0 {
		return nil, fmt.Errorf("domain: target %s is not a multiple of source %s", target, source)
	}

	ratio := tgtMin / srcMin
	tgtDur := target.Duration()

	type bucket struct {
		start time.Time
		bars  []Candle
	}
	buckets := make(map[int64]*bucket)
	order := make([]int64, 0)

	for _, c := range candles {
		start := c.Time.Truncate(tgtDur)
		key := start.Unix()
		b, ok := buckets[key]
		if !ok {
			b = &bucket{start: start}
			buckets[key] = b
			order = append(order, key)
		}
		b.bars = append(b.bars, c)
	}

	out := make([]Candle, 0, len(order))
	for _, key := range order {
		b := buckets[key]
		if len(b.bars) != ratio {
			continue
		}
		out = append(out, aggregateBucket(b.bars, b.start))
	}

	return out, nil
}

func aggregateBucket(bars []Candle, start time.Time) Candle {
	first := bars[0]
	last := bars[len(bars)-1]

	high := first.High
	low := first.Low
	var volume int64
	for _, b := range bars {
		if b.High > high {
			high = b.High
		}
		if b.Low < low {
			low = b.Low
		}
		volume += b.Volume
	}

	c := Candle{
		Time:   start,
		Open:   first.Open,
		High:   high,
		Low:    low,
		Close:  last.Close,
		Volume: volume,
	}
	if last.OI != nil {
		oi := *last.OI
		c.OI = &oi
	}
	return c
}
