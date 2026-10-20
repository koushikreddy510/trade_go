package flattrade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// StreamInstrument identifies an instrument in the Flattrade streaming feed.
type StreamInstrument struct {
	Exchange string
	Token    string
}

func (i StreamInstrument) Key() string { return i.Exchange + "|" + i.Token }

// Tick is the normalized, merged touchline state. Flattrade sends one complete
// tk snapshot and subsequent sparse tf changes, so Raw always contains values
// inherited from the last snapshot as well as the latest delta.
type Tick struct {
	Exchange  string            `json:"exchange"`
	Token     string            `json:"token"`
	Symbol    string            `json:"symbol,omitempty"`
	LastPrice float64           `json:"last_price,omitempty"`
	UpdatedAt time.Time         `json:"updated_at"`
	Raw       map[string]string `json:"raw"`
}

// OrderUpdate is a broker-originated order lifecycle event. It must be
// reconciled against REST order/position snapshots after reconnects.
type OrderUpdate struct {
	BrokerOrderID string            `json:"broker_order_id"`
	AccountID     string            `json:"account_id,omitempty"`
	Status        string            `json:"status,omitempty"`
	ReportType    string            `json:"report_type,omitempty"`
	FilledQty     int               `json:"filled_qty,omitempty"`
	FillQty       int               `json:"fill_qty,omitempty"`
	AveragePrice  float64           `json:"average_price,omitempty"`
	FillPrice     float64           `json:"fill_price,omitempty"`
	ReceivedAt    time.Time         `json:"received_at"`
	Raw           map[string]string `json:"raw"`
}

// ConnectionState communicates feed lifecycle to observability and the UI.
type ConnectionState string

const (
	StreamConnecting   ConnectionState = "connecting"
	StreamConnected    ConnectionState = "connected"
	StreamDisconnected ConnectionState = "disconnected"
	StreamReconnecting ConnectionState = "reconnecting"
)

type ConnectionEvent struct {
	State ConnectionState
	At    time.Time
	Err   error
}

// StreamConfig defines callbacks for the single Flattrade WebSocket. Callbacks
// should enqueue work quickly; slow business logic must not block feed reads.
type StreamConfig struct {
	AccountID    string
	Instruments  []StreamInstrument
	OnTick       func(Tick)
	OnOrder      func(OrderUpdate)
	OnConnection func(ConnectionEvent)
	OnError      func(error)
}

// Stream maintains one authenticated Flattrade connection. It is deliberately
// separate from Client's REST API: creating it never opens a socket.
type Stream struct {
	client *Client
	cfg    StreamConfig
	mu     sync.RWMutex
	ticks  map[string]Tick
}

func NewStream(client *Client, cfg StreamConfig) (*Stream, error) {
	if client == nil {
		return nil, errors.New("flattrade: stream client required")
	}
	if strings.TrimSpace(client.userID) == "" || strings.TrimSpace(client.SessionToken()) == "" {
		return nil, ErrNotConfigured
	}
	if cfg.AccountID == "" {
		cfg.AccountID = client.userID
	}
	return &Stream{client: client, cfg: cfg, ticks: make(map[string]Tick)}, nil
}

// Tick returns a copy of the latest merged touchline state for an instrument.
func (s *Stream) Tick(instrument StreamInstrument) (Tick, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.ticks[instrument.Key()]
	if !ok {
		return Tick{}, false
	}
	v.Raw = cloneFields(v.Raw)
	return v, true
}

// Run connects, authenticates, subscribes to market and order updates, and
// reconnects with bounded backoff until ctx is cancelled. It never sends orders.
func (s *Stream) Run(ctx context.Context) error {
	backoff := time.Second
	first := true
	for {
		if err := ctx.Err(); err != nil {
			return nil
		}
		if first {
			s.connection(StreamConnecting, nil)
			first = false
		} else {
			s.connection(StreamReconnecting, nil)
		}
		err := s.runOnce(ctx)
		if ctx.Err() != nil {
			return nil
		}
		s.connection(StreamDisconnected, err)
		if s.cfg.OnError != nil && err != nil {
			s.cfg.OnError(err)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (s *Stream) runOnce(ctx context.Context) error {
	conn, _, err := websocket.Dial(ctx, s.client.websocketURL, nil)
	if err != nil {
		return fmt.Errorf("flattrade: websocket dial: %w", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "atlas disconnect")

	var writeMu sync.Mutex
	write := func(payload any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		child, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		return wsJSON(child, conn, payload)
	}
	if err := write(map[string]string{"t": "a", "uid": s.client.userID, "actid": s.cfg.AccountID, "accesstoken": s.client.SessionToken(), "source": "API"}); err != nil {
		return err
	}

	heartbeatDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatDone:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = write(map[string]string{"t": "h"})
			}
		}
	}()
	defer close(heartbeatDone)

	authenticated := false
	for {
		_, payload, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("flattrade: websocket read: %w", err)
		}
		var fields map[string]any
		if err := json.Unmarshal(payload, &fields); err != nil {
			return fmt.Errorf("flattrade: websocket decode: %w", err)
		}
		typ := field(fields, "t")
		if !authenticated && (typ == "ck" || typ == "ak") {
			if !strings.EqualFold(field(fields, "s"), "OK") {
				return fmt.Errorf("flattrade: websocket authentication rejected: %s", field(fields, "emsg"))
			}
			if err := s.subscribe(write); err != nil {
				return err
			}
			authenticated = true
			s.connection(StreamConnected, nil)
			continue
		}
		switch typ {
		case "tk", "tf":
			s.handleTick(fields)
		case "om":
			s.handleOrder(fields)
		case "ck":
			if !strings.EqualFold(field(fields, "s"), "OK") {
				return fmt.Errorf("flattrade: websocket connection rejected: %s", field(fields, "emsg"))
			}
		}
	}
}

func (s *Stream) subscribe(write func(any) error) error {
	if len(s.cfg.Instruments) > 0 {
		keys := make([]string, 0, len(s.cfg.Instruments))
		for _, instrument := range s.cfg.Instruments {
			if instrument.Exchange != "" && instrument.Token != "" {
				keys = append(keys, instrument.Key())
			}
		}
		if len(keys) > 0 {
			if err := write(map[string]string{"t": "t", "k": strings.Join(keys, "#")}); err != nil {
				return fmt.Errorf("flattrade: websocket subscribe market data: %w", err)
			}
		}
	}
	return write(map[string]string{"t": "o", "actid": s.cfg.AccountID})
}

func (s *Stream) handleTick(fields map[string]any) {
	exchange, token := field(fields, "e"), field(fields, "tk")
	if exchange == "" || token == "" {
		return
	}
	key := exchange + "|" + token
	s.mu.Lock()
	previous := s.ticks[key]
	merged := cloneFields(previous.Raw)
	if merged == nil {
		merged = make(map[string]string)
	}
	for k, v := range fields {
		merged[k] = stringify(v)
	}
	price, _ := strconv.ParseFloat(merged["lp"], 64)
	tick := Tick{Exchange: exchange, Token: token, Symbol: merged["ts"], LastPrice: price, UpdatedAt: time.Now().UTC(), Raw: merged}
	s.ticks[key] = tick
	s.mu.Unlock()
	if s.cfg.OnTick != nil {
		s.cfg.OnTick(copyTick(tick))
	}
}

func (s *Stream) handleOrder(fields map[string]any) {
	raw := make(map[string]string, len(fields))
	for k, v := range fields {
		raw[k] = stringify(v)
	}
	update := OrderUpdate{BrokerOrderID: raw["norenordno"], AccountID: raw["actid"], Status: raw["status"], ReportType: raw["reporttype"], FilledQty: intField(raw, "fillshares"), FillQty: intField(raw, "flqty"), AveragePrice: floatField(raw, "avgprc"), FillPrice: floatField(raw, "flprc"), ReceivedAt: time.Now().UTC(), Raw: raw}
	if s.cfg.OnOrder != nil {
		s.cfg.OnOrder(update)
	}
}

func (s *Stream) connection(state ConnectionState, err error) {
	if s.cfg.OnConnection != nil {
		s.cfg.OnConnection(ConnectionEvent{State: state, At: time.Now().UTC(), Err: err})
	}
}
func wsJSON(ctx context.Context, conn *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, payload)
}
func field(fields map[string]any, key string) string { return stringify(fields[key]) }
func stringify(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case json.Number:
		return v.String()
	default:
		return fmt.Sprint(v)
	}
}
func intField(fields map[string]string, key string) int {
	value, _ := strconv.Atoi(fields[key])
	return value
}
func floatField(fields map[string]string, key string) float64 {
	value, _ := strconv.ParseFloat(fields[key], 64)
	return value
}
func cloneFields(value map[string]string) map[string]string {
	if len(value) == 0 {
		return nil
	}
	out := make(map[string]string, len(value))
	for k, v := range value {
		out[k] = v
	}
	return out
}
func copyTick(value Tick) Tick { value.Raw = cloneFields(value.Raw); return value }
