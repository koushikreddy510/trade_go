package workflow

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/events"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// Engine orchestrates workflow lifecycle and runs the processor pipeline.
type Engine struct {
	bus events.Bus
}

// NewEngine returns a workflow engine. bus may be nil to skip event publishing.
func NewEngine(bus events.Bus) *Engine {
	return &Engine{bus: bus}
}

// Start runs wf through pipeline, updating lifecycle status and publishing events.
// If wf.Status is already COMPLETED, Start is a no-op (idempotent).
func (e *Engine) Start(ctx context.Context, wf domain.Workflow, ec *execctx.ExecutionContext, pipeline *Pipeline) error {
	if wf.Status == domain.WorkflowCompleted {
		return nil
	}

	if wf.ID == "" {
		id, err := newWorkflowID()
		if err != nil {
			return fmt.Errorf("workflow: generate id: %w", err)
		}
		wf.ID = id
	}

	if ec != nil {
		ec.WorkflowID = wf.ID
	}

	now := time.Now()
	wf.Status = domain.WorkflowRunning
	wf.StartedAt = now

	if err := e.publish(ctx, events.WorkflowStarted, wf); err != nil {
		return err
	}

	if err := pipeline.Run(ctx, ec); err != nil {
		wf.Status = domain.WorkflowFailed
		wf.CompletedAt = time.Now()
		return fmt.Errorf("workflow %s: %w", wf.ID, err)
	}

	wf.Status = domain.WorkflowCompleted
	wf.CompletedAt = time.Now()

	if err := e.publish(ctx, events.WorkflowCompleted, wf); err != nil {
		return err
	}

	return nil
}

func (e *Engine) publish(ctx context.Context, typ events.EventType, wf domain.Workflow) error {
	if e.bus == nil {
		return nil
	}
	return e.bus.Publish(ctx, events.Event{
		Type:       typ,
		WorkflowID: wf.ID,
		Payload:    wf,
		Timestamp:  time.Now(),
	})
}

func newWorkflowID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
