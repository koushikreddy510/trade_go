package trade

import (
	"context"
	"errors"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// ProcessorConfig optionally attaches a broker for PAPER/LIVE execution.
type ProcessorConfig struct {
	Broker broker.Broker
	Mode   domain.ExecutionMode
}

// Processor applies strategy signals to the trade manager and appends resulting
// trades to the execution context.
type Processor struct {
	manager *Manager
	broker  broker.Broker
	mode    domain.ExecutionMode
}

// NewProcessor returns a pipeline stage backed by manager.
// When cfg is nil or Broker is nil, trades are opened with immediate simulation fills.
func NewProcessor(manager *Manager, cfg *ProcessorConfig) *Processor {
	p := &Processor{manager: manager}
	if cfg != nil {
		p.broker = cfg.Broker
		p.mode = cfg.Mode
	}
	return p
}

// Name returns the processor identifier.
func (p *Processor) Name() string {
	return "trade"
}

// Process consumes ec.Signals, opens/closes trades, and appends to ec.Trades.
func (p *Processor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if ec == nil {
		return errors.New("trade: nil execution context")
	}
	if p.manager == nil {
		return errors.New("trade: manager required")
	}

	marketClose := lastClose(ec.Market)
	now := ec.Timestamp

	for _, sig := range ec.Signals {
		switch sig.Action {
		case domain.ActionBuy, domain.ActionSell:
			entry := entryPrice(sig, marketClose)
			var entryOrderID string
			if p.broker != nil {
				id, err := p.placeEntryOrder(ctx, sig, entry)
				if err != nil {
					return fmt.Errorf("trade: place entry order: %w", err)
				}
				entryOrderID = id
			}

			trade, err := p.manager.OpenTrade(ctx, ec.WorkflowID, ec.ConfigVersion, sig, entry, now)
			if errors.Is(err, ErrDuplicateOpen) {
				continue
			}
			if err != nil {
				return err
			}

			if entryOrderID != "" {
				trade, err = p.manager.SetEntryOrderID(ctx, trade.TradeID, entryOrderID)
				if err != nil {
					return fmt.Errorf("trade: set entry order id: %w", err)
				}
			}

			if p.mode == domain.ExecutionLive && p.broker != nil && sig.StopLoss > 0 {
				slID, err := p.placeStopLossOrder(ctx, trade, sig.StopLoss)
				if err != nil {
					return fmt.Errorf("trade: place stop loss order: %w", err)
				}
				if slID != "" {
					trade, err = p.manager.SetStopLossOrderID(ctx, trade.TradeID, slID)
					if err != nil {
						return fmt.Errorf("trade: set stop loss order id: %w", err)
					}
				}
			}

			ec.Trades = append(ec.Trades, *trade)

		case domain.ActionExit:
			exit := exitPrice(sig, marketClose)
			if p.broker != nil {
				if err := p.placeExitOrder(ctx, sig, exit); err != nil {
					return fmt.Errorf("trade: place exit order: %w", err)
				}
			}

			trade, err := p.manager.CloseBySignal(ctx, sig, exit, now)
			if errors.Is(err, ErrNoOpenTrade) {
				continue
			}
			if err != nil {
				return err
			}
			ec.Trades = append(ec.Trades, *trade)

		case domain.ActionIgnore:
			continue
		}
	}

	return nil
}

func (p *Processor) placeEntryOrder(ctx context.Context, sig domain.Signal, price float64) (string, error) {
	side := domain.SideBuy
	if sig.Action == domain.ActionSell {
		side = domain.SideSell
	}
	res, err := p.broker.PlaceOrder(ctx, broker.PlaceRequest{
		Symbol:    sig.Symbol,
		Side:      side,
		Qty:       sig.Quantity,
		Price:     price,
		PriceType: "LMT",
		OrderType: domain.OrderTypeEntry,
		Remarks:   fmt.Sprintf("atlas entry %s", sig.StrategyID),
	})
	if err != nil {
		return "", err
	}
	return res.BrokerOrderID, nil
}

func (p *Processor) placeStopLossOrder(ctx context.Context, tr *domain.Trade, stopLoss float64) (string, error) {
	exitSide := domain.SideSell
	if tr.Side == domain.SideSell {
		exitSide = domain.SideBuy
	}
	res, err := p.broker.PlaceOrder(ctx, broker.PlaceRequest{
		Symbol:       tr.Symbol,
		Side:         exitSide,
		Qty:          tr.Quantity,
		Price:        stopLoss,
		TriggerPrice: stopLoss,
		PriceType:    "SL-LMT",
		OrderType:    domain.OrderTypeSL,
		Remarks:      fmt.Sprintf("atlas sl %s", tr.StrategyID),
	})
	if err != nil {
		return "", err
	}
	return res.BrokerOrderID, nil
}

func (p *Processor) placeExitOrder(ctx context.Context, sig domain.Signal, price float64) error {
	active, err := p.findActiveTrade(sig)
	if err != nil {
		return err
	}
	if active == nil {
		return nil
	}

	exitSide := domain.SideSell
	if active.Side == domain.SideSell {
		exitSide = domain.SideBuy
	}
	res, err := p.broker.PlaceOrder(ctx, broker.PlaceRequest{
		Symbol:    sig.Symbol,
		Side:      exitSide,
		Qty:       active.Quantity,
		Price:     price,
		PriceType: "LMT",
		OrderType: domain.OrderTypeExit,
		Remarks:   fmt.Sprintf("atlas exit %s", sig.StrategyID),
	})
	if err != nil {
		return err
	}
	if res.BrokerOrderID != "" {
		_, err = p.manager.SetExitOrderID(ctx, active.TradeID, res.BrokerOrderID)
	}
	return err
}

func (p *Processor) findActiveTrade(sig domain.Signal) (*domain.Trade, error) {
	for _, tr := range p.manager.GetActive() {
		if tr.StrategyID == sig.StrategyID && tr.Symbol == sig.Symbol {
			cp := tr
			return &cp, nil
		}
	}
	return nil, nil
}

var _ engine.Processor = (*Processor)(nil)
