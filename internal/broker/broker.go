// Package broker defines the execution broker contract for live and paper trading.
package broker

import (
	"context"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// Broker places and manages orders at an external or simulated venue.
type Broker interface {
	Name() string
	PlaceOrder(ctx context.Context, req PlaceRequest) (*PlaceResult, error)
	ModifyOrder(ctx context.Context, req ModifyRequest) error
	CancelOrder(ctx context.Context, brokerOrderID string) error
}

// PlaceRequest is a normalized order placement request.
type PlaceRequest struct {
	Symbol       domain.Symbol
	Side         domain.Side
	Qty          int
	Price        float64 // 0 = market-like; Flattrade commodity needs LMT — use price
	TriggerPrice float64 // for SL-LMT
	OrderType    domain.OrderType
	PriceType    string // LMT / SL-LMT
	Product      string // default M (NRML) for MCX
	Remarks      string
}

// ModifyRequest is a normalized order modification request.
type ModifyRequest struct {
	BrokerOrderID string
	Symbol        domain.Symbol
	Qty           int
	Price         float64
	TriggerPrice  float64
	PriceType     string // LMT / SL-LMT
	Retention     string // DAY
}

// PlaceResult is returned after a successful order placement.
type PlaceResult struct {
	BrokerOrderID string
	Status        domain.OrderStatus
	Raw           any
}
