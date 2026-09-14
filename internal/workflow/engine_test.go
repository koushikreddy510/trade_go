package workflow_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/events"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/workflow"
)

func TestEngineLifecycleSuccess(t *testing.T) {
	t.Parallel()

	bus := events.NewBus()
	defer bus.Close()

	startedCh, _ := bus.Subscribe(events.WorkflowStarted, 1)
	completedCh, _ := bus.Subscribe(events.WorkflowCompleted, 1)

	eng := workflow.NewEngine(bus)

	var ran bool
	pipe := workflow.NewPipeline(stubProcessor{
		name: "step",
		process: func(context.Context, *execctx.ExecutionContext) error {
			ran = true
			return nil
		},
	})

	wf := domain.Workflow{
		ID:        "wf-1",
		Type:      domain.WorkflowMarket,
		Status:    domain.WorkflowCreated,
		Symbol:    domain.Symbol{Exchange: "MCX", Token: "26000", Name: "SILVERM"},
		Timeframe: domain.TF1H,
	}
	ec := &execctx.ExecutionContext{Symbol: wf.Symbol, Timeframe: wf.Timeframe}

	if err := eng.Start(context.Background(), wf, ec, pipe); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !ran {
		t.Fatal("pipeline did not run")
	}
	if ec.WorkflowID != "wf-1" {
		t.Fatalf("ec.WorkflowID = %q, want wf-1", ec.WorkflowID)
	}

	started := readEvent(t, startedCh, time.Second)
	if started.Type != events.WorkflowStarted || started.WorkflowID != "wf-1" {
		t.Fatalf("started event: %+v", started)
	}

	completed := readEvent(t, completedCh, time.Second)
	if completed.Type != events.WorkflowCompleted || completed.WorkflowID != "wf-1" {
		t.Fatalf("completed event: %+v", completed)
	}

	payload, ok := completed.Payload.(domain.Workflow)
	if !ok {
		t.Fatalf("completed payload type %T, want domain.Workflow", completed.Payload)
	}
	if payload.Status != domain.WorkflowCompleted {
		t.Fatalf("status = %s, want COMPLETED", payload.Status)
	}
	if payload.StartedAt.IsZero() || payload.CompletedAt.IsZero() {
		t.Fatalf("timestamps not set: started=%v completed=%v", payload.StartedAt, payload.CompletedAt)
	}
}

func TestEngineGeneratesWorkflowID(t *testing.T) {
	t.Parallel()

	eng := workflow.NewEngine(nil)
	pipe := workflow.NewPipeline(stubProcessor{name: "noop"})

	wf := domain.Workflow{Status: domain.WorkflowCreated}
	ec := &execctx.ExecutionContext{}

	if err := eng.Start(context.Background(), wf, ec, pipe); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if ec.WorkflowID == "" {
		t.Fatal("expected generated WorkflowID on ec")
	}
	if len(ec.WorkflowID) != 32 {
		t.Fatalf("WorkflowID length = %d, want 32 hex chars", len(ec.WorkflowID))
	}
}

func TestEngineIdempotentCompleted(t *testing.T) {
	t.Parallel()

	bus := events.NewBus()
	defer bus.Close()

	startedCh, _ := bus.Subscribe(events.WorkflowStarted, 1)
	eng := workflow.NewEngine(bus)

	var ran bool
	pipe := workflow.NewPipeline(stubProcessor{
		name: "step",
		process: func(context.Context, *execctx.ExecutionContext) error {
			ran = true
			return nil
		},
	})

	wf := domain.Workflow{
		ID:     "wf-done",
		Status: domain.WorkflowCompleted,
	}
	ec := &execctx.ExecutionContext{}

	if err := eng.Start(context.Background(), wf, ec, pipe); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if ran {
		t.Fatal("pipeline should not run for completed workflow")
	}
	if ec.WorkflowID != "" {
		t.Fatalf("ec.WorkflowID = %q, want empty", ec.WorkflowID)
	}

	select {
	case e := <-startedCh:
		t.Fatalf("unexpected WorkflowStarted: %+v", e)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestEnginePipelineFailureSetsFailed(t *testing.T) {
	t.Parallel()

	bus := events.NewBus()
	defer bus.Close()

	startedCh, _ := bus.Subscribe(events.WorkflowStarted, 1)
	completedCh, _ := bus.Subscribe(events.WorkflowCompleted, 1)

	eng := workflow.NewEngine(bus)

	wantErr := errors.New("market unavailable")
	pipe := workflow.NewPipeline(stubProcessor{
		name: "market",
		process: func(context.Context, *execctx.ExecutionContext) error {
			return wantErr
		},
	})

	wf := domain.Workflow{
		ID:     "wf-fail",
		Status: domain.WorkflowCreated,
	}
	ec := &execctx.ExecutionContext{}

	err := eng.Start(context.Background(), wf, ec, pipe)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if ec.WorkflowID != "wf-fail" {
		t.Fatalf("ec.WorkflowID = %q, want wf-fail", ec.WorkflowID)
	}

	started := readEvent(t, startedCh, time.Second)
	payload, ok := started.Payload.(domain.Workflow)
	if !ok {
		t.Fatalf("started payload type %T, want domain.Workflow", started.Payload)
	}
	if payload.Status != domain.WorkflowRunning {
		t.Fatalf("status = %s, want RUNNING", payload.Status)
	}

	select {
	case e := <-completedCh:
		t.Fatalf("unexpected WorkflowCompleted: %+v", e)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestEngineNilBusSkipsEvents(t *testing.T) {
	t.Parallel()

	eng := workflow.NewEngine(nil)
	pipe := workflow.NewPipeline(stubProcessor{name: "noop"})

	wf := domain.Workflow{ID: "wf-nil-bus", Status: domain.WorkflowCreated}
	if err := eng.Start(context.Background(), wf, &execctx.ExecutionContext{}, pipe); err != nil {
		t.Fatalf("Start: %v", err)
	}
}

func readEvent(t *testing.T, ch <-chan events.Event, timeout time.Duration) events.Event {
	t.Helper()
	select {
	case e := <-ch:
		return e
	case <-time.After(timeout):
		t.Fatal("timed out waiting for event")
		return events.Event{}
	}
}
