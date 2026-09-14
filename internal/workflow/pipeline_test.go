package workflow_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/workflow"
)

type stubProcessor struct {
	name    string
	process func(ctx context.Context, ec *execctx.ExecutionContext) error
}

func (p stubProcessor) Name() string { return p.name }

func (p stubProcessor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if p.process != nil {
		return p.process(ctx, ec)
	}
	return nil
}

func TestPipelineRunsProcessorsInOrder(t *testing.T) {
	t.Parallel()

	var order []string
	p1 := stubProcessor{name: "market", process: func(context.Context, *execctx.ExecutionContext) error {
		order = append(order, "market")
		return nil
	}}
	p2 := stubProcessor{name: "indicator", process: func(context.Context, *execctx.ExecutionContext) error {
		order = append(order, "indicator")
		return nil
	}}
	p3 := stubProcessor{name: "strategy", process: func(context.Context, *execctx.ExecutionContext) error {
		order = append(order, "strategy")
		return nil
	}}

	pipe := workflow.NewPipeline(p1, p2, p3)
	if err := pipe.Run(context.Background(), &execctx.ExecutionContext{}); err != nil {
		t.Fatalf("Run: %v", err)
	}

	want := []string{"market", "indicator", "strategy"}
	if len(order) != len(want) {
		t.Fatalf("order = %v, want %v", order, want)
	}
	for i, name := range want {
		if order[i] != name {
			t.Fatalf("order[%d] = %q, want %q (full order %v)", i, order[i], name, order)
		}
	}
}

func TestPipelineStopsOnFirstError(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("boom")
	var order []string

	p1 := stubProcessor{name: "first", process: func(context.Context, *execctx.ExecutionContext) error {
		order = append(order, "first")
		return nil
	}}
	p2 := stubProcessor{name: "failing", process: func(context.Context, *execctx.ExecutionContext) error {
		order = append(order, "failing")
		return wantErr
	}}
	p3 := stubProcessor{name: "third", process: func(context.Context, *execctx.ExecutionContext) error {
		order = append(order, "third")
		return nil
	}}

	pipe := workflow.NewPipeline(p1, p2, p3)
	err := pipe.Run(context.Background(), &execctx.ExecutionContext{})
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if got := err.Error(); got != "failing: boom" {
		t.Fatalf("error message = %q, want %q", got, "failing: boom")
	}
	if len(order) != 2 || order[0] != "first" || order[1] != "failing" {
		t.Fatalf("order = %v, want [first failing]", order)
	}
}

func TestPipelineEmpty(t *testing.T) {
	t.Parallel()

	pipe := workflow.NewPipeline()
	if err := pipe.Run(context.Background(), &execctx.ExecutionContext{}); err != nil {
		t.Fatalf("Run: %v", err)
	}
}

// Ensure stubProcessor satisfies engine.Processor.
var _ engine.Processor = stubProcessor{}

func TestPipelineProcessorNameInError(t *testing.T) {
	t.Parallel()

	p := stubProcessor{name: "trade", process: func(context.Context, *execctx.ExecutionContext) error {
		return fmt.Errorf("order rejected")
	}}
	err := workflow.NewPipeline(p).Run(context.Background(), &execctx.ExecutionContext{})
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); got != "trade: order rejected" {
		t.Fatalf("error = %q, want %q", got, "trade: order rejected")
	}
}
