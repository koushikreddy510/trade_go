package workflow_test

import (
	"context"
	"testing"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/workflow"
)

func TestMemoryStoreSaveGet(t *testing.T) {
	t.Parallel()

	store := workflow.NewMemoryStore()
	wf := domain.Workflow{
		ID:     "wf-store",
		Type:   domain.WorkflowMarket,
		Status: domain.WorkflowRunning,
	}

	ctx := context.Background()
	if err := store.Save(ctx, wf); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := store.Get(ctx, "wf-store")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != wf.ID || got.Status != wf.Status {
		t.Fatalf("got %+v, want %+v", got, wf)
	}
}
