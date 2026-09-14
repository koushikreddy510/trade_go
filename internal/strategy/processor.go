package strategy

import (
	"context"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// Processor runs registered strategies and appends their signals to ExecutionContext.
// Multiple strategies may emit independent signals; no portfolio conflict resolution.
type Processor struct {
	strategies []Strategy
}

// NewProcessor creates a processor that runs the given strategies.
func NewProcessor(strategies []Strategy) *Processor {
	return &Processor{strategies: append([]Strategy(nil), strategies...)}
}

// NewProcessorFromRegistry creates a processor from all strategies in a registry.
func NewProcessorFromRegistry(reg *Registry) *Processor {
	if reg == nil {
		return &Processor{}
	}
	return NewProcessor(reg.All())
}

func (p *Processor) Name() string { return "strategy" }

func (p *Processor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if ec == nil {
		return fmt.Errorf("strategy processor: nil execution context")
	}

	for _, s := range p.strategies {
		signals, err := s.Evaluate(ctx, ec)
		if err != nil {
			return fmt.Errorf("strategy %q: %w", s.ID(), err)
		}
		if len(signals) == 0 {
			continue
		}
		ec.Signals = append(ec.Signals, signals...)
	}
	return nil
}

// Compile-time check that Processor implements engine.Processor.
var _ engine.Processor = (*Processor)(nil)
