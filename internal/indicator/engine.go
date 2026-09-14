package indicator

import (
	"context"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

// Engine holds registered indicator instances and computes snapshots over candles.
type Engine struct {
	byID    map[string]Indicator
	byKey   map[string]string
	order   []string
}

// NewEngine creates an empty indicator engine.
func NewEngine() *Engine {
	return &Engine{
		byID:  make(map[string]Indicator),
		byKey: make(map[string]string),
	}
}

// Register adds an indicator instance. Duplicate IDs are rejected.
// Indicators with the same name and parameters share one runtime instance.
func (e *Engine) Register(ind Indicator) error {
	if ind == nil {
		return fmt.Errorf("indicator: cannot register nil indicator")
	}
	id := ind.ID()
	if id == "" {
		return fmt.Errorf("indicator: empty id")
	}
	if _, exists := e.byID[id]; exists {
		return fmt.Errorf("indicator: duplicate id %q", id)
	}

	key, _, err := paramKeyFromIndicator(ind)
	if err != nil {
		return fmt.Errorf("indicator: register %q: %w", id, err)
	}
	if existingID, ok := e.byKey[key]; ok {
		e.byID[id] = e.byID[existingID]
		return nil
	}

	e.byID[id] = ind
	e.byKey[key] = id
	e.order = append(e.order, id)
	return nil
}

// IDs returns registered indicator ids in registration order (canonical instances only).
func (e *Engine) IDs() []string {
	seen := make(map[Indicator]bool, len(e.order))
	out := make([]string, 0, len(e.order))
	for _, id := range e.order {
		ind := e.byID[id]
		if seen[ind] {
			continue
		}
		seen[ind] = true
		out = append(out, id)
	}
	return out
}

// ComputeAll runs each registered indicator over candles.
func (e *Engine) ComputeAll(candles []domain.Candle) (map[string]domain.IndicatorSnapshot, error) {
	out := make(map[string]domain.IndicatorSnapshot, len(e.byID))
	seen := make(map[Indicator]bool, len(e.order))

	for _, id := range e.order {
		ind := e.byID[id]
		if seen[ind] {
			continue
		}
		seen[ind] = true

		snap, err := ind.Compute(candles)
		if err != nil {
			return nil, fmt.Errorf("indicator %q: %w", id, err)
		}
		out[id] = snap
	}

	for id, ind := range e.byID {
		if _, ok := out[id]; ok {
			continue
		}
		canonicalID, ok := e.byKey[instanceKeyFromIndicator(ind)]
		if !ok {
			continue
		}
		if snap, ok := out[canonicalID]; ok {
			out[id] = snap
		}
	}

	return out, nil
}

func instanceKeyFromIndicator(ind Indicator) string {
	snap, _ := ind.Compute(nil)
	params := make(map[string]float64, len(snap.Parameters))
	for k, v := range snap.Parameters {
		if k == "direction" {
			continue
		}
		params[k] = v
	}
	return instanceKey(ind.Name(), params)
}

// IndicatorProcessor runs registered indicators against market candles.
type IndicatorProcessor struct {
	engine *Engine
}

// NewIndicatorProcessor creates a processor backed by the given engine.
func NewIndicatorProcessor(engine *Engine) *IndicatorProcessor {
	return &IndicatorProcessor{engine: engine}
}

func (p *IndicatorProcessor) Name() string { return "indicator" }

func (p *IndicatorProcessor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if p.engine == nil {
		return fmt.Errorf("indicator processor: nil engine")
	}
	if ec == nil {
		return fmt.Errorf("indicator processor: nil execution context")
	}

	snapshots, err := p.engine.ComputeAll(ec.Market.Candles)
	if err != nil {
		return err
	}

	if ec.Indicators == nil {
		ec.Indicators = make(map[string]domain.IndicatorSnapshot, len(snapshots))
	}
	for id, snap := range snapshots {
		snap.Symbol = ec.Symbol
		snap.Timeframe = ec.Timeframe
		ec.Indicators[id] = snap
	}
	return nil
}
