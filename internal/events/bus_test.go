package events

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestMultiSubscriberReceive(t *testing.T) {
	bus := NewBus()
	ch1, _ := bus.Subscribe(MarketUpdated, 1)
	ch2, _ := bus.Subscribe(MarketUpdated, 1)

	want := Event{
		Type:    MarketUpdated,
		Payload: "snapshot",
	}

	ctx := context.Background()
	if err := bus.Publish(ctx, want); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	got1 := <-ch1
	got2 := <-ch2

	if got1.Type != want.Type || got1.Payload != want.Payload {
		t.Errorf("ch1: got %+v, want %+v", got1, want)
	}
	if got2.Type != want.Type || got2.Payload != want.Payload {
		t.Errorf("ch2: got %+v, want %+v", got2, want)
	}
	if got1.Timestamp.IsZero() {
		t.Error("expected Timestamp to be set")
	}
}

func TestUnsubscribeStopsDelivery(t *testing.T) {
	bus := NewBus()
	ch1, unsub1 := bus.Subscribe(SignalGenerated, 1)
	ch2, _ := bus.Subscribe(SignalGenerated, 1)

	unsub1()

	ctx := context.Background()
	if err := bus.Publish(ctx, Event{Type: SignalGenerated, Payload: 42}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	got := <-ch2
	if got.Payload != 42 {
		t.Errorf("ch2 payload: got %v, want 42", got.Payload)
	}

	if e, ok := <-ch1; ok {
		t.Fatalf("unsubscribed channel received event: %+v", e)
	}
}

func TestPublishContextCancel(t *testing.T) {
	bus := NewBus()
	_, _ = bus.Subscribe(TradeOpened, 0) // unbuffered — Publish blocks

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := bus.Publish(ctx, Event{Type: TradeOpened, Payload: "blocked"})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
}

func TestPublishContextTimeout(t *testing.T) {
	bus := NewBus()
	_, _ = bus.Subscribe(OrderFilled, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	err := bus.Publish(ctx, Event{Type: OrderFilled, Payload: "blocked"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v, want context.DeadlineExceeded", err)
	}
}

func TestClose(t *testing.T) {
	bus := NewBus()
	ch1, unsub1 := bus.Subscribe(WorkflowStarted, 1)
	ch2, _ := bus.Subscribe(WorkflowCompleted, 1)

	if err := bus.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	if _, ok := <-ch1; ok {
		t.Error("ch1 should be closed after Close")
	}
	if _, ok := <-ch2; ok {
		t.Error("ch2 should be closed after Close")
	}

	unsub1() // noop after Close

	err := bus.Publish(context.Background(), Event{Type: WorkflowStarted})
	if !errors.Is(err, ErrBusClosed) {
		t.Fatalf("Publish after Close: got %v, want ErrBusClosed", err)
	}

	postCh, _ := bus.Subscribe(NewCandle, 1)
	if _, ok := <-postCh; ok {
		t.Error("Subscribe after Close should return closed channel")
	}
}

func TestPublishPredefinedEventTypes(t *testing.T) {
	bus := NewBus()
	types := []EventType{
		NewCandle,
		MarketUpdated,
		IndicatorsUpdated,
		SignalGenerated,
		TradeOpened,
		TradeClosed,
		OrderFilled,
		WorkflowStarted,
		WorkflowCompleted,
	}

	chans := make([]<-chan Event, len(types))
	for i, typ := range types {
		ch, _ := bus.Subscribe(typ, 1)
		chans[i] = ch
	}

	ctx := context.Background()
	for _, typ := range types {
		if err := bus.Publish(ctx, Event{Type: typ}); err != nil {
			t.Fatalf("Publish %s: %v", typ, err)
		}
	}

	for i, ch := range chans {
		got := <-ch
		if got.Type != types[i] {
			t.Errorf("got type %s, want %s", got.Type, types[i])
		}
	}
}

func BenchmarkPublishSubscribe(b *testing.B) {
	bus := NewBus()
	ch, unsub := bus.Subscribe(MarketUpdated, 64)
	defer unsub()
	defer bus.Close()

	ctx := context.Background()
	e := Event{Type: MarketUpdated, Payload: "bench"}

	// Drain subscriber in background so Publish does not block.
	done := make(chan struct{})
	go func() {
		for {
			select {
			case <-ch:
			case <-done:
				return
			}
		}
	}()
	defer func() { close(done) }()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := bus.Publish(ctx, e); err != nil {
			b.Fatal(err)
		}
	}
}
