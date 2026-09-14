package paper_test

import (
	"context"
	"strings"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/plugins/broker/paper"
)

func TestPaperBrokerPlaceOrder(t *testing.T) {
	t.Parallel()

	b := paper.New()
	result, err := b.PlaceOrder(context.Background(), broker.PlaceRequest{
		Symbol: domain.Symbol{Exchange: "MCX", Name: "SILVERM"},
		Side:   domain.SideBuy,
		Qty:    1,
		Price:  75000,
	})
	if err != nil {
		t.Fatalf("PlaceOrder: %v", err)
	}
	if !strings.HasPrefix(result.BrokerOrderID, "SIM-") {
		t.Fatalf("broker order id = %q, want SIM- prefix", result.BrokerOrderID)
	}
	if result.Status != domain.OrderStatusFilled {
		t.Fatalf("status = %q, want FILLED", result.Status)
	}
}

func TestPaperBrokerName(t *testing.T) {
	t.Parallel()

	if paper.New().Name() != "paper" {
		t.Fatal("unexpected broker name")
	}
}
