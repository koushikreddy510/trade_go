package trailing

import (
	"context"
	"errors"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

// Config controls trailing processor behavior.
type Config struct {
	EMAIndicatorKey string
	Broker          broker.Broker
	Mode            domain.ExecutionMode
	Log             *logging.Logger
}

// DefaultConfig returns V1 trailing defaults.
func DefaultConfig() Config {
	return Config{
		EMAIndicatorKey: "ema_bias",
	}
}

// Processor evaluates trailing policies for open trades on each bar.
type Processor struct {
	manager *trade.Manager
	policy  Policy
	cfg     Config
}

// NewProcessor returns a trailing pipeline stage.
func NewProcessor(manager *trade.Manager, policy Policy, cfg Config) *Processor {
	if policy == nil {
		return nil
	}
	if cfg.EMAIndicatorKey == "" {
		cfg = DefaultConfig()
	}
	return &Processor{manager: manager, policy: policy, cfg: cfg}
}

// Name returns the processor identifier.
func (p *Processor) Name() string {
	return "trailing"
}

// Process updates stop-loss levels for active trades using the latest candle close.
func (p *Processor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if ec == nil {
		return errors.New("trailing: nil execution context")
	}
	if p.manager == nil {
		return errors.New("trailing: manager required")
	}
	if p.policy == nil {
		return errors.New("trailing: policy required")
	}

	candle, ok := lastCandle(ec.Market)
	if !ok {
		return nil
	}

	ema := emaValue(ec.Indicators, p.cfg.EMAIndicatorKey)

	for _, openTrade := range p.manager.GetActive() {
		newSL, changed := p.policy.NextStopLoss(openTrade, candle.Close, ema)
		if !changed {
			continue
		}

		updated, err := p.manager.MoveStopLoss(openTrade.TradeID, newSL)
		if err != nil {
			return err
		}

		if p.cfg.Mode == domain.ExecutionLive && p.cfg.Broker != nil && openTrade.StopLossOrderID != "" {
			if err := p.cfg.Broker.ModifyOrder(ctx, broker.ModifyRequest{
				BrokerOrderID: openTrade.StopLossOrderID,
				Symbol:        openTrade.Symbol,
				Qty:           openTrade.Quantity,
				Price:         newSL,
				TriggerPrice:  newSL,
				PriceType:     "SL-LMT",
			}); err != nil {
				if p.cfg.Log != nil {
					p.cfg.Log.Warn("failed to modify stop loss order",
						"error", err,
						"trade_id", openTrade.TradeID,
						"order_id", openTrade.StopLossOrderID,
					)
				}
			}
		}

		ec.Trades = append(ec.Trades, *updated)
	}

	return nil
}

func lastCandle(market domain.MarketSnapshot) (domain.Candle, bool) {
	n := len(market.Candles)
	if n == 0 {
		return domain.Candle{}, false
	}
	return market.Candles[n-1], true
}

func emaValue(indicators map[string]domain.IndicatorSnapshot, key string) float64 {
	if len(indicators) == 0 || key == "" {
		return 0
	}
	snap, ok := indicators[key]
	if !ok || len(snap.Values) == 0 {
		return 0
	}
	return snap.Values[len(snap.Values)-1]
}

var _ engine.Processor = (*Processor)(nil)
