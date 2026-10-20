package terminal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/report"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/plugins/broker/paper"
)

// StrategyID namespaces operator-placed terminal trades so they do not collide
// with strategy-managed positions on the same symbol.
const StrategyID = "terminal"

var (
	ErrLiveOrdersDisabled = errors.New("terminal: live broker orders are disabled")
	ErrNoMarkPrice        = errors.New("terminal: no last price available")
)

// Quote is the browser-facing last-trade snapshot for one instrument.
type Quote struct {
	Exchange  string    `json:"exchange"`
	Token     string    `json:"token"`
	Symbol    string    `json:"symbol"`
	LastPrice float64   `json:"last_price"`
	Volume    string    `json:"volume,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

// OrderEvent is a broker-originated fill/status update.
type OrderEvent struct {
	BrokerOrderID string    `json:"broker_order_id"`
	Status        string    `json:"status,omitempty"`
	ReportType    string    `json:"report_type,omitempty"`
	FilledQty     int       `json:"filled_qty,omitempty"`
	AveragePrice  float64   `json:"average_price,omitempty"`
	ReceivedAt    time.Time `json:"received_at"`
}

// ConnectionEvt reports Flattrade stream lifecycle to the UI.
type ConnectionEvt struct {
	State string `json:"state"`
	Error string `json:"error,omitempty"`
	At    time.Time `json:"at"`
}

// LiveSnapshot is the combined quote, PnL, and position view.
type LiveSnapshot struct {
	Mode       string         `json:"mode"`
	Stream     string         `json:"stream"`
	Quote      Quote          `json:"quote"`
	PnL        report.Summary `json:"pnl"`
	Positions  []domain.Trade `json:"positions"`
	LiveOrders bool           `json:"live_orders"`
}

// OrderRequest is a manual buy/sell from the terminal.
type OrderRequest struct {
	Side     string  `json:"side"`
	Quantity int     `json:"quantity"`
	Price    float64 `json:"price"`
	StopLoss float64 `json:"stop_loss"`
	Target   float64 `json:"target"`
	TradeID  string  `json:"trade_id"`
}

// LiveConfig wires the terminal's live feed to trades and an execution broker.
type LiveConfig struct {
	Trades     *trade.Manager
	Broker     broker.Broker
	Symbol     domain.Symbol
	Mode       domain.ExecutionMode
	LiveOrders bool
}

// Live holds last quotes, marks open trades, and places operator orders.
type Live struct {
	hub        *Hub
	trades     *trade.Manager
	broker     broker.Broker
	symbol     domain.Symbol
	mode       domain.ExecutionMode
	liveOrders bool

	mu     sync.RWMutex
	quote  Quote
	stream ConnectionEvt
}

func NewLive(cfg LiveConfig) *Live {
	br := cfg.Broker
	if br == nil {
		br = paper.New()
	}
	return &Live{
		hub:        NewHub(),
		trades:     cfg.Trades,
		broker:     br,
		symbol:     cfg.Symbol,
		mode:       cfg.Mode,
		liveOrders: cfg.LiveOrders,
		stream:     ConnectionEvt{State: "disconnected", At: time.Now().UTC()},
	}
}

func (l *Live) Hub() *Hub { return l.hub }

func (l *Live) OnTick(quote Quote) {
	if l == nil {
		return
	}
	if quote.UpdatedAt.IsZero() {
		quote.UpdatedAt = time.Now().UTC()
	}
	l.mu.Lock()
	l.quote = quote
	l.mu.Unlock()
	if l.trades != nil && quote.LastPrice > 0 {
		for _, position := range l.trades.GetActive() {
			if position.Symbol.Exchange == quote.Exchange && position.Symbol.Token == quote.Token {
				_, _ = l.trades.UpdateUnrealizedPnL(position.TradeID, quote.LastPrice)
			}
		}
	}
	l.hub.Publish(Event{Type: "tick", Tick: &quote, Snapshot: ptrSnapshot(l.Snapshot())})
}

func (l *Live) OnOrder(order OrderEvent) {
	if l == nil {
		return
	}
	l.hub.Publish(Event{Type: "order", Order: &order, Snapshot: ptrSnapshot(l.Snapshot())})
}

func (l *Live) OnConnection(state, errMsg string) {
	if l == nil {
		return
	}
	evt := ConnectionEvt{State: state, Error: errMsg, At: time.Now().UTC()}
	l.mu.Lock()
	l.stream = evt
	l.mu.Unlock()
	l.hub.Publish(Event{Type: "connection", Connection: &evt, Snapshot: ptrSnapshot(l.Snapshot())})
}

func (l *Live) Snapshot() LiveSnapshot {
	if l == nil {
		return LiveSnapshot{Stream: "disconnected"}
	}
	l.mu.RLock()
	quote := l.quote
	stream := l.stream
	l.mu.RUnlock()
	positions := []domain.Trade{}
	var summary report.Summary
	if l.trades != nil {
		positions = l.trades.GetActive()
		summary = report.Build(l.trades.ListTrades(), time.Now().UTC())
	}
	mode := string(l.mode)
	if mode == "" {
		mode = "SIMULATION"
	}
	return LiveSnapshot{
		Mode:       mode,
		Stream:     stream.State,
		Quote:      quote,
		PnL:        summary,
		Positions:  positions,
		LiveOrders: l.liveOrders && l.mode == domain.ExecutionLive,
	}
}

func (l *Live) Place(ctx context.Context, req OrderRequest) (*domain.Trade, error) {
	if l == nil || l.trades == nil {
		return nil, fmt.Errorf("terminal: live trading is not configured")
	}
	if l.mode == domain.ExecutionLive && !l.liveOrders {
		return nil, ErrLiveOrdersDisabled
	}
	side := domain.Action(strings.ToUpper(strings.TrimSpace(req.Side)))
	if side != domain.ActionBuy && side != domain.ActionSell {
		return nil, fmt.Errorf("%w: side must be BUY or SELL", trade.ErrInvalidSignal)
	}
	if req.Quantity <= 0 {
		return nil, fmt.Errorf("%w: quantity required", trade.ErrInvalidSignal)
	}
	price := req.Price
	if price <= 0 {
		l.mu.RLock()
		price = l.quote.LastPrice
		l.mu.RUnlock()
	}
	if price <= 0 {
		return nil, ErrNoMarkPrice
	}
	if l.broker != nil {
		if _, err := l.broker.PlaceOrder(ctx, broker.PlaceRequest{
			Symbol:    l.symbol,
			Side:      domain.Side(side),
			Qty:       req.Quantity,
			Price:     price,
			PriceType: "LMT",
			OrderType: domain.OrderTypeEntry,
			Remarks:   "atlas terminal",
		}); err != nil {
			return nil, err
		}
	}
	metadata := map[string]string{}
	if req.Target > 0 {
		metadata[trade.MetadataTarget] = fmt.Sprintf("%g", req.Target)
	}
	opened, err := l.trades.OpenTrade(ctx, "terminal", 0, domain.Signal{
		StrategyID: StrategyID,
		Symbol:     l.symbol,
		Action:     side,
		Quantity:   req.Quantity,
		StopLoss:   req.StopLoss,
		Metadata:   metadata,
	}, price, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if price > 0 {
		opened, _ = l.trades.UpdateUnrealizedPnL(opened.TradeID, price)
	}
	l.hub.Publish(Event{Type: "snapshot", Snapshot: ptrSnapshot(l.Snapshot())})
	return opened, nil
}

func (l *Live) Close(ctx context.Context, tradeID string, price float64) (*domain.Trade, error) {
	if l == nil || l.trades == nil {
		return nil, fmt.Errorf("terminal: live trading is not configured")
	}
	if l.mode == domain.ExecutionLive && !l.liveOrders {
		return nil, ErrLiveOrdersDisabled
	}
	if price <= 0 {
		l.mu.RLock()
		price = l.quote.LastPrice
		l.mu.RUnlock()
	}
	if price <= 0 {
		return nil, ErrNoMarkPrice
	}
	existing, ok := l.trades.GetTrade(tradeID)
	if !ok {
		return nil, trade.ErrTradeNotFound
	}
	if l.broker != nil {
		exitSide := domain.SideSell
		if existing.Side == domain.SideSell {
			exitSide = domain.SideBuy
		}
		if _, err := l.broker.PlaceOrder(ctx, broker.PlaceRequest{
			Symbol:    existing.Symbol,
			Side:      exitSide,
			Qty:       existing.Quantity,
			Price:     price,
			PriceType: "LMT",
			OrderType: domain.OrderTypeExit,
			Remarks:   "atlas terminal exit",
		}); err != nil {
			return nil, err
		}
	}
	closed, err := l.trades.CloseTrade(ctx, tradeID, price, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	l.hub.Publish(Event{Type: "snapshot", Snapshot: ptrSnapshot(l.Snapshot())})
	return closed, nil
}
