package flattrade_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
	"nhooyr.io/websocket"
)

func TestStreamAuthenticatesMergesDeltasAndPublishesOrders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		assertMessage(t, ctx, conn, "a")
		writeMessage(t, ctx, conn, map[string]string{"t": "ck", "s": "OK"})
		assertMessage(t, ctx, conn, "t")
		assertMessage(t, ctx, conn, "o")
		writeMessage(t, ctx, conn, map[string]string{"t": "tk", "e": "MCX", "tk": "99", "ts": "SILVERMIC", "lp": "75000", "v": "10"})
		writeMessage(t, ctx, conn, map[string]string{"t": "tf", "e": "MCX", "tk": "99", "lp": "75005"})
		writeMessage(t, ctx, conn, map[string]string{"t": "om", "norenordno": "order-1", "actid": "FT0001", "status": "COMPLETE", "reporttype": "Fill", "fillshares": "2", "flqty": "1", "avgprc": "75001"})
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var mu sync.Mutex
	var ticks []flattrade.Tick
	var orders []flattrade.OrderUpdate
	client := flattrade.NewClient(flattrade.Config{UserID: "FT0001", SessionToken: "jkey", WebSocketURL: "ws" + strings.TrimPrefix(server.URL, "http")})
	stream, err := flattrade.NewStream(client, flattrade.StreamConfig{Instruments: []flattrade.StreamInstrument{{Exchange: "MCX", Token: "99"}}, OnTick: func(tick flattrade.Tick) { mu.Lock(); ticks = append(ticks, tick); mu.Unlock() }, OnOrder: func(order flattrade.OrderUpdate) { mu.Lock(); orders = append(orders, order); mu.Unlock(); cancel() }})
	if err != nil {
		t.Fatal(err)
	}
	if err := stream.Run(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(ticks) != 2 || ticks[1].LastPrice != 75005 || ticks[1].Raw["v"] != "10" {
		t.Fatalf("ticks = %#v", ticks)
	}
	if len(orders) != 1 || orders[0].BrokerOrderID != "order-1" || orders[0].FilledQty != 2 {
		t.Fatalf("orders = %#v", orders)
	}
	latest, ok := stream.Tick(flattrade.StreamInstrument{Exchange: "MCX", Token: "99"})
	if !ok || latest.LastPrice != 75005 {
		t.Fatalf("latest = %#v, %v", latest, ok)
	}
}

func TestNewStreamRequiresSession(t *testing.T) {
	client := flattrade.NewClient(flattrade.Config{UserID: "FT0001"})
	if _, err := flattrade.NewStream(client, flattrade.StreamConfig{}); err == nil {
		t.Fatal("expected missing session error")
	}
}

func assertMessage(t *testing.T, ctx context.Context, conn *websocket.Conn, typ string) {
	t.Helper()
	_, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got["t"] != typ {
		t.Fatalf("message type = %q, want %q (%s)", got["t"], typ, payload)
	}
}
func writeMessage(t *testing.T, ctx context.Context, conn *websocket.Conn, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, payload); err != nil {
		t.Fatal(err)
	}
}
