// Package paper provides an in-memory broker that immediately fills virtual orders.
package paper

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
)

// Broker implements broker.Broker with immediate FILLED virtual order IDs.
type Broker struct{}

// New returns a paper broker for PAPER execution mode.
func New() *Broker {
	return &Broker{}
}

// Name returns the broker identifier.
func (b *Broker) Name() string {
	return "paper"
}

// PlaceOrder assigns a virtual SIM-{uuid} order ID and marks the order filled.
func (b *Broker) PlaceOrder(_ context.Context, _ broker.PlaceRequest) (*broker.PlaceResult, error) {
	id, err := newSimOrderID()
	if err != nil {
		return nil, fmt.Errorf("paper: generate order id: %w", err)
	}
	return &broker.PlaceResult{
		BrokerOrderID: id,
		Status:        domain.OrderStatusFilled,
	}, nil
}

// ModifyOrder is a no-op in paper mode.
func (b *Broker) ModifyOrder(_ context.Context, _ broker.ModifyRequest) error {
	return nil
}

// CancelOrder is a no-op in paper mode.
func (b *Broker) CancelOrder(_ context.Context, _ string) error {
	return nil
}

func newSimOrderID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "SIM-" + hex.EncodeToString(b[:]), nil
}

var _ broker.Broker = (*Broker)(nil)
