// Package simulation evaluates open trades against candle high/low for virtual
// stop-loss and target exits. It does not place broker orders.
//
// When Risk.Target is zero and AutoTarget is enabled (default), an effective
// target is derived as entry ± (|entry − stopLoss| × RiskReward). For BUY
// trades: target = entry + risk × RR; for SELL: target = entry − risk × RR.
package simulation

import (
	"context"
	"errors"
	"math"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

// Config controls simulation exit behavior.
type Config struct {
	// AutoTarget derives a 2R target when Risk.Target is zero.
	AutoTarget bool
	// RiskReward is the reward multiple applied to risk distance (default 2).
	RiskReward float64
}

// DefaultConfig returns simulation defaults for V1.
func DefaultConfig() Config {
	return Config{
		AutoTarget: true,
		RiskReward: 2.0,
	}
}

// Processor evaluates OPEN trades against the latest candle in ec.Market.
type Processor struct {
	manager *trade.Manager
	cfg     Config
}

// NewProcessor returns a simulation pipeline stage.
func NewProcessor(manager *trade.Manager, cfg Config) *Processor {
	if cfg.RiskReward <= 0 {
		cfg.RiskReward = DefaultConfig().RiskReward
	}
	return &Processor{manager: manager, cfg: cfg}
}

// Name returns the processor identifier.
func (p *Processor) Name() string {
	return "simulation"
}

// Process checks stop-loss and target levels for active trades.
func (p *Processor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if ec == nil {
		return errors.New("simulation: nil execution context")
	}
	if p.manager == nil {
		return errors.New("simulation: manager required")
	}

	candle, ok := lastCandle(ec.Market)
	if !ok {
		return nil
	}

	for _, openTrade := range p.manager.GetActive() {
		exitPrice, shouldClose := p.evaluateExit(openTrade, candle)
		if !shouldClose {
			if _, err := p.manager.UpdateUnrealizedPnL(openTrade.TradeID, candle.Close); err != nil {
				return err
			}
			continue
		}

		closed, err := p.manager.CloseTrade(ctx, openTrade.TradeID, exitPrice, ec.Timestamp)
		if err != nil {
			return err
		}
		ec.Trades = append(ec.Trades, *closed)
	}

	return nil
}

func (p *Processor) evaluateExit(t domain.Trade, c domain.Candle) (float64, bool) {
	sl := t.Risk.StopLoss
	if sl <= 0 {
		return 0, false
	}

	target := effectiveTarget(t, p.cfg)

	switch t.Side {
	case domain.SideBuy:
		if c.Low <= sl {
			return sl, true
		}
		if target > 0 && c.High >= target {
			return target, true
		}
	case domain.SideSell:
		if c.High >= sl {
			return sl, true
		}
		if target > 0 && c.Low <= target {
			return target, true
		}
	}

	return 0, false
}

func effectiveTarget(t domain.Trade, cfg Config) float64 {
	if t.Risk.Target > 0 {
		return t.Risk.Target
	}
	if !cfg.AutoTarget || t.Risk.StopLoss <= 0 {
		return 0
	}

	entry := t.Position.AvgPrice
	risk := math.Abs(entry - t.Risk.StopLoss)
	rr := cfg.RiskReward
	if rr <= 0 {
		rr = DefaultConfig().RiskReward
	}

	switch t.Side {
	case domain.SideBuy:
		return entry + risk*rr
	case domain.SideSell:
		return entry - risk*rr
	default:
		return 0
	}
}

func lastCandle(market domain.MarketSnapshot) (domain.Candle, bool) {
	n := len(market.Candles)
	if n == 0 {
		return domain.Candle{}, false
	}
	return market.Candles[n-1], true
}

var _ engine.Processor = (*Processor)(nil)
