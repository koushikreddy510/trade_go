package domain

import "time"

// TradeState is the lifecycle state of a trade aggregate.
type TradeState string

const (
	TradeStateNew                TradeState = "NEW"
	TradeStateSignalReceived     TradeState = "SIGNAL_RECEIVED"
	TradeStateValidated          TradeState = "VALIDATED"
	TradeStateEntryOrderCreated  TradeState = "ENTRY_ORDER_CREATED"
	TradeStateEntryPending       TradeState = "ENTRY_PENDING"
	TradeStateOpen               TradeState = "OPEN"
	TradeStateSLPlaced           TradeState = "SL_PLACED"
	TradeStateTargetPlaced       TradeState = "TARGET_PLACED"
	TradeStateTrailing           TradeState = "TRAILING"
	TradeStateExitPending        TradeState = "EXIT_PENDING"
	TradeStateClosed             TradeState = "CLOSED"
	TradeStateArchived           TradeState = "ARCHIVED"
	TradeStateRejected           TradeState = "REJECTED"
	TradeStateCancelled          TradeState = "CANCELLED"
)

// Side is the directional exposure of a trade or position.
type Side string

const (
	SideBuy  Side = "BUY"
	SideSell Side = "SELL"
)

// OrderType classifies the role of an order within a trade lifecycle.
type OrderType string

const (
	OrderTypeEntry  OrderType = "ENTRY"
	OrderTypeSL     OrderType = "SL"
	OrderTypeTarget OrderType = "TARGET"
	OrderTypeExit   OrderType = "EXIT"
)

// OrderStatus tracks independent order lifecycle state.
type OrderStatus string

const (
	OrderStatusNew       OrderStatus = "NEW"
	OrderStatusSent      OrderStatus = "SENT"
	OrderStatusOpen      OrderStatus = "OPEN"
	OrderStatusPartial   OrderStatus = "PARTIAL"
	OrderStatusFilled    OrderStatus = "FILLED"
	OrderStatusCancelled OrderStatus = "CANCELLED"
	OrderStatusRejected  OrderStatus = "REJECTED"
)

// Trade is the aggregate root for execution. It owns orders, position, risk,
// trailing, and PnL. Only the trade manager mutates trades.
type Trade struct {
	TradeID       string
	WorkflowID    string
	StrategyID    string
	ConfigVersion int
	Symbol        Symbol
	Side          Side
	Quantity      int
	State         TradeState

	EntryOrderID    string
	StopLossOrderID string
	TargetOrderID   string
	ExitOrderID     string

	Position Position
	Risk     RiskState
	Trailing TrailingState
	Metadata map[string]string
}

// Position is derived state owned by a trade. It is never edited outside the trade aggregate.
type Position struct {
	AvgPrice      float64
	Quantity      int
	RealizedPnL   float64
	UnrealizedPnL float64
	EntryTime     time.Time
	ExitTime      time.Time
}

// Order belongs to a trade and tracks fill progress. BrokerOrderID is used for
// correlation when a live broker is attached; it is absent in simulation mode.
type Order struct {
	ID              string
	BrokerOrderID   string
	TradeID         string
	Type            OrderType
	Status          OrderStatus
	FilledQuantity  int
	AveragePrice    float64
}

// RiskState captures risk parameters enforced by the trade manager.
type RiskState struct {
	StopLoss   float64
	Target     float64
	MaxLoss    float64
	RiskAmount float64
}

// TrailingState captures trailing stop configuration and the current stop level.
type TrailingState struct {
	Enabled    bool
	StopLoss   float64
	PolicyName string
}
