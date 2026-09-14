// Package strategy defines the strategy plugin contract and orchestration for Atlas.
package strategy

import (
	"context"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// Strategy evaluates market and indicator context and produces trading signals.
type Strategy interface {
	ID() string
	Evaluate(ctx context.Context, ec *execctx.ExecutionContext) ([]domain.Signal, error)
}
