// Package events provides a channel-based event bus for cross-cutting concerns
// (logging hooks, metrics, broker WS fan-in). It is not the main processor pipeline.
package events

import (
	"context"
	"time"
)

// EventType identifies a category of bus event.
type EventType string

// Common event types used across Atlas.
const (
	NewCandle           EventType = "new_candle"
	MarketUpdated       EventType = "market_updated"
	IndicatorsUpdated   EventType = "indicators_updated"
	SignalGenerated     EventType = "signal_generated"
	TradeOpened         EventType = "trade_opened"
	TradeClosed         EventType = "trade_closed"
	OrderFilled         EventType = "order_filled"
	WorkflowStarted     EventType = "workflow_started"
	WorkflowCompleted   EventType = "workflow_completed"
)

// Event is a single message on the bus.
type Event struct {
	Type       EventType
	Payload    any
	Timestamp  time.Time
	WorkflowID string // optional correlation ID
}

// Bus publishes events to buffered subscriber channels.
// Publish blocks until each subscriber accepts the event or ctx is cancelled.
// Slow consumers therefore slow publishers; use ctx deadlines on hot paths if needed.
type Bus interface {
	Publish(ctx context.Context, e Event) error
	Subscribe(eventType EventType, buffer int) (<-chan Event, func())
	Close() error
}
