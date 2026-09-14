package events

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrBusClosed is returned when Publish is called after Close.
var ErrBusClosed = errors.New("event bus closed")

type subscription struct {
	ch  chan Event
	typ EventType
}

type bus struct {
	mu          sync.RWMutex
	subscribers map[EventType][]*subscription
	closed      bool
}

// NewBus returns a thread-safe event bus.
func NewBus() Bus {
	return &bus{
		subscribers: make(map[EventType][]*subscription),
	}
}

func (b *bus) Subscribe(eventType EventType, buffer int) (<-chan Event, func()) {
	ch := make(chan Event, buffer)
	sub := &subscription{ch: ch, typ: eventType}

	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		close(ch)
		return ch, func() {}
	}
	b.subscribers[eventType] = append(b.subscribers[eventType], sub)
	b.mu.Unlock()

	unsubscribe := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if b.closed {
			return
		}
		subs := b.subscribers[eventType]
		for i, s := range subs {
			if s == sub {
				b.subscribers[eventType] = append(subs[:i], subs[i+1:]...)
				close(ch)
				return
			}
		}
	}

	return ch, unsubscribe
}

func (b *bus) Publish(ctx context.Context, e Event) error {
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now()
	}

	b.mu.RLock()
	if b.closed {
		b.mu.RUnlock()
		return ErrBusClosed
	}
	subs := b.subscribers[e.Type]
	chans := make([]chan Event, len(subs))
	for i, s := range subs {
		chans[i] = s.ch
	}
	b.mu.RUnlock()

	for _, ch := range chans {
		select {
		case ch <- e:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (b *bus) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil
	}
	b.closed = true
	for _, subs := range b.subscribers {
		for _, s := range subs {
			close(s.ch)
		}
	}
	b.subscribers = make(map[EventType][]*subscription)
	return nil
}
