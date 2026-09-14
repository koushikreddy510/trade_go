// Package dual_supertrend_ema implements the Atlas V1 dual Supertrend + EMA strategy.
//
// V1 decision rules (entry timeframe candles and indicators on ec):
//
//   - Read indicator instances st_lower, st_higher, ema_bias from ec.Indicators.
//   - st_lower / st_higher direction comes from Supertrend Parameters["direction"] (+1 bullish, -1 bearish).
//   - ema_bias last value is Values[len-1]; close is the last entry-TF candle close.
//
//   - BUY when st_higher direction == +1 AND st_lower direction == +1 AND close > ema_bias.
//   - SELL when st_higher direction == -1 AND st_lower direction == -1 AND close < ema_bias.
//   - EXIT when st_lower and st_higher directions conflict (regime vs entry misaligned).
//   - Otherwise IGNORE (warmup, missing data, or aligned but price vs EMA does not confirm).
//
// Stop-loss reference for BUY/SELL is the st_lower line (last Values entry).
// Confidence is 70 when a directional action is emitted; 0 for IGNORE/EXIT.
package dual_supertrend_ema

import (
	"context"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/strategy"
)

// StrategyID is the canonical plugin identifier.
const StrategyID = "dual_supertrend_ema"

// MetadataQuantityKey is the optional ExecutionContext.Metadata key for order quantity.
const MetadataQuantityKey = "quantity"

// Strategy evaluates dual Supertrend alignment with EMA bias on the entry timeframe.
type Strategy struct {
	symbol          domain.Symbol
	entryTF         domain.Timeframe
	filterTF        domain.Timeframe
	regimeTF        domain.Timeframe
	defaultQuantity int
}

// New builds a strategy from compiled YAML parameters.
func New(cfg config.DualSupertrendEMAConfig) (*Strategy, error) {
	entryTF, err := domain.ParseTimeframe(cfg.EntryTimeframe)
	if err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: entry_timeframe: %w", err)
	}
	filterTF, err := domain.ParseTimeframe(cfg.FilterTimeframe)
	if err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: filter_timeframe: %w", err)
	}
	regimeTF, err := domain.ParseTimeframe(cfg.RegimeTimeframe)
	if err != nil {
		return nil, fmt.Errorf("dual_supertrend_ema: regime_timeframe: %w", err)
	}

	symbol := domain.Symbol{Name: cfg.Symbol}
	if cfg.Symbol == "" {
		return nil, fmt.Errorf("dual_supertrend_ema: symbol required")
	}

	return &Strategy{
		symbol:          symbol,
		entryTF:         entryTF,
		filterTF:        filterTF,
		regimeTF:        regimeTF,
		defaultQuantity: 1,
	}, nil
}

func (s *Strategy) ID() string { return StrategyID }

func (s *Strategy) Evaluate(ctx context.Context, ec *execctx.ExecutionContext) ([]domain.Signal, error) {
	_ = ctx

	sig, err := s.evaluate(ec)
	if err != nil {
		return nil, err
	}
	return []domain.Signal{sig}, nil
}

func (s *Strategy) evaluate(ec *execctx.ExecutionContext) (domain.Signal, error) {
	symbol := s.resolveSymbol(ec)
	timeframes := []domain.Timeframe{s.entryTF, s.filterTF, s.regimeTF}
	qty := s.resolveQuantity(ec)

	base := domain.Signal{
		StrategyID: StrategyID,
		Symbol:     symbol,
		Quantity:   qty,
		Timeframes: timeframes,
		Metadata:   map[string]string{},
	}

	close, ok := lastClose(ec)
	if !ok {
		return s.ignore(base, "no_candles"), nil
	}

	stLower, ok := ec.Indicators[config.IndicatorSTLower]
	if !ok {
		return s.ignore(base, "missing_indicator:st_lower"), nil
	}
	stHigher, ok := ec.Indicators[config.IndicatorSTHigher]
	if !ok {
		return s.ignore(base, "missing_indicator:st_higher"), nil
	}
	emaBias, ok := ec.Indicators[config.IndicatorEMABias]
	if !ok {
		return s.ignore(base, "missing_indicator:ema_bias"), nil
	}

	lowerDir := direction(stLower)
	higherDir := direction(stHigher)
	ema := lastValue(emaBias)

	if lowerDir == 0 || higherDir == 0 {
		return s.ignore(base, "indicator_warmup"), nil
	}

	if lowerDir != higherDir {
		sig := base
		sig.Action = domain.ActionExit
		sig.Confidence = 0
		sig.Metadata["reason"] = "direction_conflict"
		return sig, nil
	}

	slLine := lastValue(stLower)

	switch {
	case higherDir > 0 && lowerDir > 0 && close > ema:
		sig := base
		sig.Action = domain.ActionBuy
		sig.Confidence = 70
		sig.StopLoss = slLine
		sig.Metadata["reason"] = "buy_aligned"
		return sig, nil
	case higherDir < 0 && lowerDir < 0 && close < ema:
		sig := base
		sig.Action = domain.ActionSell
		sig.Confidence = 70
		sig.StopLoss = slLine
		sig.Metadata["reason"] = "sell_aligned"
		return sig, nil
	default:
		return s.ignore(base, "conditions_not_met"), nil
	}
}

func (s *Strategy) resolveSymbol(ec *execctx.ExecutionContext) domain.Symbol {
	if ec != nil && ec.Symbol.Name != "" {
		return ec.Symbol
	}
	return s.symbol
}

func (s *Strategy) resolveQuantity(ec *execctx.ExecutionContext) int {
	if ec == nil || ec.Metadata == nil {
		return s.defaultQuantity
	}
	raw, ok := ec.Metadata[MetadataQuantityKey]
	if !ok {
		return s.defaultQuantity
	}
	switch v := raw.(type) {
	case int:
		if v > 0 {
			return v
		}
	case int64:
		if v > 0 {
			return int(v)
		}
	case float64:
		if v > 0 {
			return int(v)
		}
	}
	return s.defaultQuantity
}

func (s *Strategy) ignore(base domain.Signal, reason string) domain.Signal {
	sig := base
	sig.Action = domain.ActionIgnore
	sig.Confidence = 0
	sig.Metadata["reason"] = reason
	return sig
}

func lastClose(ec *execctx.ExecutionContext) (float64, bool) {
	if ec == nil || len(ec.Market.Candles) == 0 {
		return 0, false
	}
	c := ec.Market.Candles[len(ec.Market.Candles)-1]
	return c.Close, true
}

func direction(snap domain.IndicatorSnapshot) float64 {
	if snap.Parameters == nil {
		return 0
	}
	d, ok := snap.Parameters["direction"]
	if !ok {
		return 0
	}
	return d
}

func lastValue(snap domain.IndicatorSnapshot) float64 {
	if len(snap.Values) == 0 {
		return 0
	}
	return snap.Values[len(snap.Values)-1]
}

// Compile-time check that Strategy implements strategy.Strategy.
var _ strategy.Strategy = (*Strategy)(nil)
