// Package engine defines the processor pipeline contracts for Atlas workflows.
package engine

import (
	"context"

	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// Processor is a pipeline stage that reads and enriches an ExecutionContext.
// Each processor owns one responsibility (market, indicators, strategy, trade, etc.).
type Processor interface {
	Name() string
	Process(ctx context.Context, ec *execctx.ExecutionContext) error
}
