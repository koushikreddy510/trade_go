package workflow

import (
	"context"
	"fmt"
	"sync"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// Store persists workflow state (optional; used in tests and future Redis backing).
type Store interface {
	Save(ctx context.Context, wf domain.Workflow) error
	Get(ctx context.Context, id string) (domain.Workflow, error)
}

// MemoryStore is a thread-safe in-memory WorkflowStore for tests.
type MemoryStore struct {
	mu    sync.RWMutex
	items map[string]domain.Workflow
}

// NewMemoryStore returns an empty in-memory store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{items: make(map[string]domain.Workflow)}
}

// Save upserts a workflow by ID.
func (s *MemoryStore) Save(_ context.Context, wf domain.Workflow) error {
	if wf.ID == "" {
		return fmt.Errorf("workflow: save requires non-empty ID")
	}
	s.mu.Lock()
	s.items[wf.ID] = wf
	s.mu.Unlock()
	return nil
}

// Get returns a workflow by ID.
func (s *MemoryStore) Get(_ context.Context, id string) (domain.Workflow, error) {
	s.mu.RLock()
	wf, ok := s.items[id]
	s.mu.RUnlock()
	if !ok {
		return domain.Workflow{}, fmt.Errorf("workflow: %q not found", id)
	}
	return wf, nil
}
