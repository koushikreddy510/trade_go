package scheduler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/events"
)

// Scheduler decides when jobs fire. It never runs business logic — only
// invokes registered handlers and optionally publishes bus events.
type Scheduler struct {
	mu       sync.Mutex
	handlers map[JobType][]Handler
	entries  map[string]*recurringEntry
	bus      events.Bus
	now      func() time.Time
}

type recurringEntry struct {
	job      Job
	nextFire func(after time.Time) time.Time // nil => remove after fire (one-shot)
}

// New returns a scheduler. bus may be nil to skip event publishing.
func New(bus events.Bus) *Scheduler {
	return &Scheduler{
		handlers: make(map[JobType][]Handler),
		entries:  make(map[string]*recurringEntry),
		bus:      bus,
		now:      time.Now,
	}
}

// SetClock overrides the wall clock (for tests). Pass nil to restore time.Now.
func (s *Scheduler) SetClock(now func() time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if now == nil {
		s.now = time.Now
		return
	}
	s.now = now
}

// Register adds a handler for jobType. Multiple handlers per type are allowed.
func (s *Scheduler) Register(jobType JobType, h Handler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.handlers[jobType] = append(s.handlers[jobType], h)
}

// RegisterFunc is a convenience wrapper around Register.
func (s *Scheduler) RegisterFunc(jobType JobType, fn func(ctx context.Context, job Job) error) {
	s.Register(jobType, Handler(fn))
}

// ScheduleCandleClosures registers recurring IST-aligned candle-close jobs for
// every symbol × timeframe pair. Existing entries with the same key are replaced.
func (s *Scheduler) ScheduleCandleClosures(tfs []domain.Timeframe, symbols []string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	for _, symbol := range symbols {
		for _, tf := range tfs {
			tf := tf
			key := candleEntryKey(symbol, tf)
			s.entries[key] = &recurringEntry{
				job: Job{
					Type:      JobCandleClosed,
					Symbol:    symbol,
					Timeframe: tf,
					FireAt:    NextCandleCloseOnOrAfter(tf, now),
				},
				nextFire: func(after time.Time) time.Time {
					return NextCandleCloseAfter(tf, after)
				},
			}
		}
	}
}

// ScheduleDailyAt registers a recurring job that fires every day at hour:minute IST.
// Used for pre-market session-token refresh (EventBridge-style daily trigger).
func (s *Scheduler) ScheduleDailyAt(jobType JobType, hour, minute int, metadata map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("daily:%s:%02d%02d", jobType, hour, minute)
	now := s.now()
	meta := cloneMetadata(metadata)
	s.entries[key] = &recurringEntry{
		job: Job{
			Type:     jobType,
			FireAt:   NextDailyAtOnOrAfter(hour, minute, now),
			Metadata: meta,
		},
		nextFire: func(after time.Time) time.Time {
			return NextDailyAtAfter(hour, minute, after)
		},
	}
}

func cloneMetadata(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// Start runs the scheduling loop until ctx is cancelled. Due jobs are fired and
// recurring candle jobs are rescheduled to the next IST boundary.
func (s *Scheduler) Start(ctx context.Context) error {
	for {
		wait, hasWork := s.nextWait()
		if !hasWork {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(50 * time.Millisecond):
				continue
			}
		}

		if wait > 0 {
			if err := s.waitUntil(ctx, s.now().Add(wait)); err != nil {
				return err
			}
		}

		if err := s.fireDue(ctx); err != nil {
			return err
		}
	}
}

// TriggerNow immediately dispatches job to registered handlers (tests, -once, replay).
func (s *Scheduler) TriggerNow(ctx context.Context, job Job) error {
	return s.dispatch(ctx, job)
}

// TriggerCandle fires a candle-closed job at at (replay / manual clock advance).
func (s *Scheduler) TriggerCandle(ctx context.Context, symbol string, tf domain.Timeframe, at time.Time) error {
	job := Job{
		Type:      JobCandleClosed,
		Symbol:    symbol,
		Timeframe: tf,
		FireAt:    at,
	}
	return s.dispatch(ctx, job)
}

func (s *Scheduler) nextWait() (time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.entries) == 0 {
		return 0, false
	}

	now := s.now()
	var earliest time.Time
	for _, e := range s.entries {
		if earliest.IsZero() || e.job.FireAt.Before(earliest) {
			earliest = e.job.FireAt
		}
	}
	wait := earliest.Sub(now)
	if wait < 0 {
		return 0, true
	}
	return wait, true
}

func (s *Scheduler) fireDue(ctx context.Context) error {
	s.mu.Lock()
	now := s.now()
	var due []Job
	for key, e := range s.entries {
		if !e.job.FireAt.After(now) {
			due = append(due, e.job)
			if e.nextFire == nil {
				delete(s.entries, key)
				continue
			}
			e.job.FireAt = e.nextFire(e.job.FireAt)
		}
	}
	handlers := s.copyHandlers()
	s.mu.Unlock()

	for _, job := range due {
		if err := s.dispatchWithHandlers(ctx, job, handlers); err != nil {
			return err
		}
	}
	return nil
}

func (s *Scheduler) dispatch(ctx context.Context, job Job) error {
	s.mu.Lock()
	handlers := s.copyHandlers()
	s.mu.Unlock()
	return s.dispatchWithHandlers(ctx, job, handlers)
}

func (s *Scheduler) copyHandlers() map[JobType][]Handler {
	out := make(map[JobType][]Handler, len(s.handlers))
	for k, v := range s.handlers {
		cp := make([]Handler, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

func (s *Scheduler) dispatchWithHandlers(ctx context.Context, job Job, handlers map[JobType][]Handler) error {
	if err := s.publishCandleEvent(ctx, job); err != nil {
		return err
	}
	for _, h := range handlers[job.Type] {
		if h == nil {
			continue
		}
		if err := h(ctx, job); err != nil {
			return fmt.Errorf("scheduler: handler %s: %w", job.Type, err)
		}
	}
	return nil
}

func (s *Scheduler) publishCandleEvent(ctx context.Context, job Job) error {
	if s.bus == nil || job.Type != JobCandleClosed {
		return nil
	}
	ts := job.FireAt
	if ts.IsZero() {
		ts = s.now()
	}
	return s.bus.Publish(ctx, events.Event{
		Type:      events.NewCandle,
		Timestamp: ts,
		Payload: CandleClosedPayload{
			Symbol:    job.Symbol,
			Timeframe: job.Timeframe,
			CloseAt:   ts,
		},
	})
}

func candleEntryKey(symbol string, tf domain.Timeframe) string {
	return fmt.Sprintf("%s:%s", symbol, tf.String())
}

// waitUntil polls until s.now() reaches deadline or ctx is cancelled.
// Polling keeps Start compatible with injected clocks in tests.
func (s *Scheduler) waitUntil(ctx context.Context, deadline time.Time) error {
	for {
		if !s.now().Before(deadline) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}
