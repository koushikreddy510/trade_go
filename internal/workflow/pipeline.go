package workflow

import (
	"context"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// Pipeline runs processors in order, stopping on the first error.
type Pipeline struct {
	processors []engine.Processor
}

// NewPipeline builds a pipeline from the given processors.
func NewPipeline(processors ...engine.Processor) *Pipeline {
	return &Pipeline{processors: processors}
}

// Run executes each processor in registration order.
// The first error aborts the pipeline; errors are wrapped with the processor name.
func (p *Pipeline) Run(ctx context.Context, ec *execctx.ExecutionContext) error {
	for _, proc := range p.processors {
		if err := proc.Process(ctx, ec); err != nil {
			return fmt.Errorf("%s: %w", proc.Name(), err)
		}
	}
	return nil
}
