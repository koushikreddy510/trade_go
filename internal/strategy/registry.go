package strategy

import "fmt"

// Registry holds registered strategy plugins by id.
type Registry struct {
	byID map[string]Strategy
}

// NewRegistry creates an empty strategy registry.
func NewRegistry() *Registry {
	return &Registry{byID: make(map[string]Strategy)}
}

// Register adds a strategy. Duplicate ids are rejected.
func (r *Registry) Register(s Strategy) error {
	if s == nil {
		return fmt.Errorf("strategy: cannot register nil strategy")
	}
	id := s.ID()
	if id == "" {
		return fmt.Errorf("strategy: empty id")
	}
	if _, exists := r.byID[id]; exists {
		return fmt.Errorf("strategy: duplicate id %q", id)
	}
	r.byID[id] = s
	return nil
}

// Get returns a strategy by id.
func (r *Registry) Get(id string) (Strategy, bool) {
	s, ok := r.byID[id]
	return s, ok
}

// All returns registered strategies in registration order.
func (r *Registry) All() []Strategy {
	out := make([]Strategy, 0, len(r.byID))
	for _, s := range r.byID {
		out = append(out, s)
	}
	return out
}
