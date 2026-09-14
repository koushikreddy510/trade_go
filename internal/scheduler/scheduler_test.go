package scheduler

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/events"
)

func TestTriggerNow_invokesHandler(t *testing.T) {
	s := New(nil)
	var got Job
	s.Register(JobDailyReport, func(ctx context.Context, job Job) error {
		got = job
		return nil
	})

	job := Job{Type: JobDailyReport, FireAt: istTime(2026, 8, 1, 23, 35)}
	if err := s.TriggerNow(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if got.Type != JobDailyReport {
		t.Fatalf("got type %q, want %q", got.Type, JobDailyReport)
	}
}

func TestTriggerCandle_publishesBusEvent(t *testing.T) {
	bus := events.NewBus()
	ch, unsub := bus.Subscribe(events.NewCandle, 1)
	defer unsub()

	s := New(bus)
	at := istTime(2026, 8, 1, 11, 0)
	if err := s.TriggerCandle(context.Background(), "SILVERM", domain.TF1H, at); err != nil {
		t.Fatal(err)
	}

	select {
	case ev := <-ch:
		if ev.Type != events.NewCandle {
			t.Fatalf("event type %q", ev.Type)
		}
		payload, ok := ev.Payload.(CandleClosedPayload)
		if !ok {
			t.Fatalf("payload type %T", ev.Payload)
		}
		if payload.Symbol != "SILVERM" || payload.Timeframe != domain.TF1H {
			t.Fatalf("payload %+v", payload)
		}
		if !payload.CloseAt.Equal(at) {
			t.Fatalf("CloseAt %v, want %v", payload.CloseAt, at)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for NewCandle event")
	}
}

func TestScheduleCandleClosures_firesAndReschedules(t *testing.T) {
	var mu sync.Mutex
	var fired []Job

	s := New(nil)
	s.Register(JobCandleClosed, func(ctx context.Context, job Job) error {
		mu.Lock()
		fired = append(fired, job)
		mu.Unlock()
		return nil
	})

	current := istTime(2026, 8, 1, 11, 0)
	s.SetClock(func() time.Time { return current })
	s.ScheduleCandleClosures([]domain.Timeframe{domain.TF1H}, []string{"GOLD"})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Start(ctx) }()

	select {
	case <-waitFor(func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(fired) >= 1
	}):
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("timeout waiting for first candle job")
	}

	mu.Lock()
	first := fired[0]
	mu.Unlock()

	if first.Symbol != "GOLD" || first.Timeframe != domain.TF1H {
		t.Fatalf("job %+v", first)
	}
	if !first.FireAt.Equal(istTime(2026, 8, 1, 11, 0)) {
		t.Fatalf("FireAt %v", first.FireAt)
	}

	current = istTime(2026, 8, 1, 12, 0)
	select {
	case <-waitFor(func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(fired) >= 2
	}):
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("timeout waiting for rescheduled candle job")
	}

	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Start returned %v, want context.Canceled", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(fired) != 2 {
		t.Fatalf("fired %d jobs, want 2", len(fired))
	}
	if !fired[1].FireAt.Equal(istTime(2026, 8, 1, 12, 0)) {
		t.Fatalf("second FireAt %v", fired[1].FireAt)
	}
}

func TestStart_cancelReturnsQuickly(t *testing.T) {
	s := New(nil)
	s.ScheduleCandleClosures([]domain.Timeframe{domain.TF1H}, []string{"SILVERM"})
	s.SetClock(func() time.Time {
		return istTime(2026, 8, 1, 8, 0)
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Start(ctx) }()

	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Start returned %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not exit after ctx cancel")
	}
}

func TestHandlerError_propagates(t *testing.T) {
	s := New(nil)
	s.Register(JobCandleClosed, func(ctx context.Context, job Job) error {
		return errors.New("boom")
	})

	err := s.TriggerNow(context.Background(), Job{Type: JobCandleClosed})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestRegisterFunc(t *testing.T) {
	s := New(nil)
	var called bool
	s.RegisterFunc(JobTrailingCheck, func(ctx context.Context, job Job) error {
		called = true
		return nil
	})
	if err := s.TriggerNow(context.Background(), Job{Type: JobTrailingCheck}); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("handler not called")
	}
}

func waitFor(cond func() bool) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		for !cond() {
			time.Sleep(5 * time.Millisecond)
		}
		close(ch)
	}()
	return ch
}
