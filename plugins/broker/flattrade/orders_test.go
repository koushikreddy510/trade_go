package flattrade_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestClientPlaceOrderRequiresToken(t *testing.T) {
	t.Parallel()

	c := flattrade.NewClient(flattrade.Config{UserID: "FT0001"})
	_, err := c.PlaceOrder(context.Background(), flattrade.PlaceOrderRequest{
		Exch: "MCX",
		Tsym: "SILVERM",
		Qty:  "1",
		Prc:  "75000",
	})
	if err != flattrade.ErrNotConfigured {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestClientPlaceOrderSuccess(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/PlaceOrder" {
			t.Fatalf("path = %q, want /PlaceOrder", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			t.Fatalf("content-type = %q", ct)
		}

		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		body := string(raw)
		if !strings.Contains(body, "jData=") || !strings.Contains(body, "jKey=test-jkey") {
			t.Fatalf("unexpected body: %q", body)
		}
		if !strings.Contains(body, "SILVERM") {
			t.Fatalf("expected tsym in body: %q", body)
		}

		_ = json.NewEncoder(w).Encode(flattrade.PlaceOrderResponse{
			Stat:       "Ok",
			NorenOrdNo: "20052000000017",
		})
	}))
	defer srv.Close()

	c := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "FT0001",
		SessionToken: "test-jkey",
		HTTPClient:   srv.Client(),
	})

	resp, err := c.PlaceOrder(context.Background(), flattrade.PlaceOrderRequest{
		Exch:     "MCX",
		Tsym:     "SILVERM",
		Qty:      "1",
		Prc:      "75000",
		Prd:      "M",
		TranType: "B",
		Prctyp:   "LMT",
		Ret:      "DAY",
	})
	if err != nil {
		t.Fatalf("PlaceOrder: %v", err)
	}
	if resp.NorenOrdNo != "20052000000017" {
		t.Fatalf("norenordno = %q", resp.NorenOrdNo)
	}
}

func TestOrderBrokerPlaceOrder(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(flattrade.PlaceOrderResponse{
			Stat:       "Ok",
			NorenOrdNo: "ORD-99",
		})
	}))
	defer srv.Close()

	c := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "FT0001",
		SessionToken: "token",
		HTTPClient:   srv.Client(),
	})
	b := flattrade.NewOrderBroker(c, "FT0001")

	result, err := b.PlaceOrder(context.Background(), broker.PlaceRequest{
		Symbol:    domain.Symbol{Exchange: "MCX", Name: "SILVERM"},
		Side:      domain.SideBuy,
		Qty:       1,
		Price:     75000,
		PriceType: "LMT",
		Product:   "M",
	})
	if err != nil {
		t.Fatalf("PlaceOrder: %v", err)
	}
	if result.BrokerOrderID != "ORD-99" {
		t.Fatalf("broker order id = %q", result.BrokerOrderID)
	}
	if result.Status != domain.OrderStatusSent {
		t.Fatalf("status = %q", result.Status)
	}
}

func TestClientModifyAndCancelRequireToken(t *testing.T) {
	t.Parallel()

	c := flattrade.NewClient(flattrade.Config{UserID: "FT0001"})

	_, err := c.ModifyOrder(context.Background(), flattrade.ModifyOrderRequest{NorenOrdNo: "1"})
	if err != flattrade.ErrNotConfigured {
		t.Fatalf("ModifyOrder: expected ErrNotConfigured, got %v", err)
	}

	_, err = c.CancelOrder(context.Background(), flattrade.CancelOrderRequest{NorenOrdNo: "1"})
	if err != flattrade.ErrNotConfigured {
		t.Fatalf("CancelOrder: expected ErrNotConfigured, got %v", err)
	}
}

func TestClientCancelOrderSuccess(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/CancelOrder" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(flattrade.CancelOrderResponse{
			Stat:       "Ok",
			NorenOrdNo: "ORD-1",
		})
	}))
	defer srv.Close()

	c := flattrade.NewClient(flattrade.Config{
		BaseURL:      srv.URL,
		UserID:       "FT0001",
		SessionToken: "token",
		HTTPClient:   srv.Client(),
	})

	resp, err := c.CancelOrder(context.Background(), flattrade.CancelOrderRequest{NorenOrdNo: "ORD-1"})
	if err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}
	if resp.NorenOrdNo != "ORD-1" {
		t.Fatalf("norenordno = %q", resp.NorenOrdNo)
	}
}
