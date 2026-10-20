package terminal

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// Event is a browser-facing live update. Type is one of snapshot, tick,
// order, or connection.
type Event struct {
	Type       string         `json:"type"`
	Snapshot   *LiveSnapshot  `json:"snapshot,omitempty"`
	Tick       *Quote         `json:"tick,omitempty"`
	Order      *OrderEvent    `json:"order,omitempty"`
	Connection *ConnectionEvt `json:"connection,omitempty"`
}

type client struct {
	ch     chan Event
	cancel context.CancelFunc
}

// Hub fans live events out to browser WebSocket subscribers. Slow clients are
// dropped rather than stalling the Flattrade read loop.
type Hub struct {
	mu      sync.Mutex
	clients map[*client]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*client]struct{})}
}

func (h *Hub) Publish(event Event) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.ch <- event:
		default:
			c.cancel()
			delete(h.clients, c)
		}
	}
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, snapshot func() LiveSnapshot) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "atlas disconnect")

	c := &client{ch: make(chan Event, 16), cancel: cancel}
	h.add(c)
	defer h.remove(c)

	if snapshot != nil {
		_ = writeEvent(ctx, conn, Event{Type: "snapshot", Snapshot: ptrSnapshot(snapshot())})
	}

	go func() {
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				cancel()
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case event := <-c.ch:
			if err := writeEvent(ctx, conn, event); err != nil {
				return
			}
		}
	}
}

func writeEvent(ctx context.Context, conn *websocket.Conn, event Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(writeCtx, websocket.MessageText, payload)
}

func ptrSnapshot(value LiveSnapshot) *LiveSnapshot { return &value }
