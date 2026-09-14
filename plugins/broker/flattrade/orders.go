package flattrade

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/domain"
)

// OrderBroker adapts Client to broker.Broker for live Flattrade execution.
type OrderBroker struct {
	client  *Client
	account string
}

// NewOrderBroker returns a live broker backed by a PiConnect client.
// account is actid; when empty, userID from the client is used.
func NewOrderBroker(client *Client, account string) *OrderBroker {
	return &OrderBroker{client: client, account: account}
}

// Name returns the broker identifier.
func (b *OrderBroker) Name() string {
	return "flattrade"
}

// PlaceOrder submits an order to Flattrade PiConnect.
func (b *OrderBroker) PlaceOrder(ctx context.Context, req broker.PlaceRequest) (*broker.PlaceResult, error) {
	resp, err := b.client.PlaceOrder(ctx, placeOrderFromBroker(req, b.client.userID, b.accountID()))
	if err != nil {
		return nil, err
	}
	return &broker.PlaceResult{
		BrokerOrderID: resp.NorenOrdNo,
		Status:        domain.OrderStatusSent,
		Raw:           resp,
	}, nil
}

// ModifyOrder updates an existing Flattrade order.
func (b *OrderBroker) ModifyOrder(ctx context.Context, req broker.ModifyRequest) error {
	_, err := b.client.ModifyOrder(ctx, modifyOrderFromBroker(req, b.client.userID, b.accountID()))
	return err
}

// CancelOrder cancels a Flattrade order by broker order ID.
func (b *OrderBroker) CancelOrder(ctx context.Context, brokerOrderID string) error {
	_, err := b.client.CancelOrder(ctx, CancelOrderRequest{
		UID:        b.client.userID,
		NorenOrdNo: brokerOrderID,
	})
	return err
}

func (b *OrderBroker) accountID() string {
	if b.account != "" {
		return b.account
	}
	return b.client.userID
}

// PlaceOrder posts a new order to PiConnect /PlaceOrder.
func (c *Client) PlaceOrder(ctx context.Context, req PlaceOrderRequest) (*PlaceOrderResponse, error) {
	if c.sessionToken == "" {
		return nil, ErrNotConfigured
	}
	if req.UID == "" {
		req.UID = c.userID
	}
	if req.ActID == "" {
		req.ActID = c.userID
	}

	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "PlaceOrder", req, c.sessionToken)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flattrade: PlaceOrder: %w", err)
	}
	defer resp.Body.Close()

	return decodeOrderResponse[PlaceOrderResponse](resp.Body, "PlaceOrder")
}

// ModifyOrder posts an order modification to PiConnect /ModifyOrder.
func (c *Client) ModifyOrder(ctx context.Context, req ModifyOrderRequest) (*ModifyOrderResponse, error) {
	if c.sessionToken == "" {
		return nil, ErrNotConfigured
	}
	if req.UID == "" {
		req.UID = c.userID
	}
	if req.ActID == "" {
		req.ActID = c.userID
	}

	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "ModifyOrder", req, c.sessionToken)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flattrade: ModifyOrder: %w", err)
	}
	defer resp.Body.Close()

	return decodeOrderResponse[ModifyOrderResponse](resp.Body, "ModifyOrder")
}

// CancelOrder posts an order cancellation to PiConnect /CancelOrder.
func (c *Client) CancelOrder(ctx context.Context, req CancelOrderRequest) (*CancelOrderResponse, error) {
	if c.sessionToken == "" {
		return nil, ErrNotConfigured
	}
	if req.UID == "" {
		req.UID = c.userID
	}

	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "CancelOrder", req, c.sessionToken)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flattrade: CancelOrder: %w", err)
	}
	defer resp.Body.Close()

	return decodeOrderResponse[CancelOrderResponse](resp.Body, "CancelOrder")
}

func placeOrderFromBroker(req broker.PlaceRequest, uid, actid string) PlaceOrderRequest {
	prctyp := req.PriceType
	if prctyp == "" {
		prctyp = "LMT"
	}
	prd := req.Product
	if prd == "" {
		prd = "M"
	}
	ret := "DAY"

	out := PlaceOrderRequest{
		UID:      uid,
		ActID:    actid,
		Exch:     req.Symbol.Exchange,
		Tsym:     req.Symbol.Name,
		Qty:      strconv.Itoa(req.Qty),
		Prc:      formatPrice(req.Price),
		Prd:      prd,
		TranType: tranType(req.Side),
		Prctyp:   prctyp,
		Ret:      ret,
		Remarks:  req.Remarks,
	}
	if req.TriggerPrice > 0 {
		out.Trgprc = formatPrice(req.TriggerPrice)
	}
	return out
}

func modifyOrderFromBroker(req broker.ModifyRequest, uid, actid string) ModifyOrderRequest {
	prctyp := req.PriceType
	if prctyp == "" {
		prctyp = "LMT"
	}
	ret := req.Retention
	if ret == "" {
		ret = "DAY"
	}

	out := ModifyOrderRequest{
		UID:        uid,
		ActID:      actid,
		Exch:       req.Symbol.Exchange,
		Tsym:       req.Symbol.Name,
		Qty:        strconv.Itoa(req.Qty),
		Prc:        formatPrice(req.Price),
		Prctyp:     prctyp,
		Ret:        ret,
		NorenOrdNo: req.BrokerOrderID,
	}
	if req.TriggerPrice > 0 {
		out.Trgprc = formatPrice(req.TriggerPrice)
	}
	return out
}

func tranType(side domain.Side) string {
	if side == domain.SideSell {
		return "S"
	}
	return "B"
}

func formatPrice(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func decodeOrderResponse[T any](r io.Reader, endpoint string) (*T, error) {
	body, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("flattrade: read %s response: %w", endpoint, err)
	}

	var out T
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("flattrade: decode %s response: %w", endpoint, err)
	}

	switch resp := any(&out).(type) {
	case *PlaceOrderResponse:
		if strings.EqualFold(resp.Stat, "Not_Ok") {
			return nil, &APIError{Stat: resp.Stat, EMsg: resp.EMsg}
		}
	case *ModifyOrderResponse:
		if strings.EqualFold(resp.Stat, "Not_Ok") {
			return nil, &APIError{Stat: resp.Stat, EMsg: resp.EMsg}
		}
	case *CancelOrderResponse:
		if strings.EqualFold(resp.Stat, "Not_Ok") {
			return nil, &APIError{Stat: resp.Stat, EMsg: resp.EMsg}
		}
	}

	return &out, nil
}

var _ broker.Broker = (*OrderBroker)(nil)
