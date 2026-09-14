package scheduler

import (
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// IST is the Asia/Kolkata location used for MCX-aligned candle boundaries.
var IST *time.Location

func init() {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		panic("scheduler: load Asia/Kolkata: " + err.Error())
	}
	IST = loc
}

// IsCandleCloseBoundary reports whether t is an IST top-of-hour aligned with tf.
// 1H: every hour; 2H: hour%2==0; 4H: hour%4==0.
func IsCandleCloseBoundary(tf domain.Timeframe, t time.Time) bool {
	ist := t.In(IST)
	if ist.Minute() != 0 || ist.Second() != 0 || ist.Nanosecond() != 0 {
		return false
	}
	switch tf {
	case domain.TF1H:
		return true
	case domain.TF2H:
		return ist.Hour()%2 == 0
	case domain.TF4H:
		return ist.Hour()%4 == 0
	default:
		return false
	}
}

// NextCandleCloseAfter returns the next IST-aligned candle close strictly after t.
func NextCandleCloseAfter(tf domain.Timeframe, t time.Time) time.Time {
	ist := t.In(IST)
	candidate := time.Date(
		ist.Year(), ist.Month(), ist.Day(),
		ist.Hour(), 0, 0, 0, IST,
	)
	if !t.Before(candidate) {
		candidate = candidate.Add(time.Hour)
	}
	return alignCandleClose(tf, candidate)
}

// NextCandleCloseOnOrAfter returns the next IST-aligned candle close at or after t.
func NextCandleCloseOnOrAfter(tf domain.Timeframe, t time.Time) time.Time {
	ist := t.In(IST)
	candidate := time.Date(
		ist.Year(), ist.Month(), ist.Day(),
		ist.Hour(), 0, 0, 0, IST,
	)
	if t.After(candidate) {
		candidate = candidate.Add(time.Hour)
	}
	aligned := alignCandleClose(tf, candidate)
	if aligned.Before(t) {
		return NextCandleCloseAfter(tf, t)
	}
	return aligned
}

func alignCandleClose(tf domain.Timeframe, candidate time.Time) time.Time {
	switch tf {
	case domain.TF1H:
		return candidate
	case domain.TF2H:
		for candidate.Hour()%2 != 0 {
			candidate = candidate.Add(time.Hour)
		}
		return candidate
	case domain.TF4H:
		for candidate.Hour()%4 != 0 {
			candidate = candidate.Add(time.Hour)
		}
		return candidate
	default:
		return candidate
	}
}

// NextDailyAtOnOrAfter returns the next IST clock time at hour:minute on or after t.
func NextDailyAtOnOrAfter(hour, minute int, t time.Time) time.Time {
	ist := t.In(IST)
	candidate := time.Date(ist.Year(), ist.Month(), ist.Day(), hour, minute, 0, 0, IST)
	if t.After(candidate) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

// NextDailyAtAfter returns the next IST clock time at hour:minute strictly after t.
func NextDailyAtAfter(hour, minute int, t time.Time) time.Time {
	ist := t.In(IST)
	candidate := time.Date(ist.Year(), ist.Month(), ist.Day(), hour, minute, 0, 0, IST)
	if !t.Before(candidate) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
