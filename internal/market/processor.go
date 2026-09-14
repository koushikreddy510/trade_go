package market

import (
	"context"
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/engine"
	"github.com/koushik-bangaru/atlas/internal/execctx"
)

const (
	MetadataKeyTimeframes  = "timeframes"
	MetadataKeyMarketByTF  = "market_by_tf"
	defaultLookback        = 100
)

// ProcessorConfig configures MarketProcessor.
type ProcessorConfig struct {
	Service   *Service
	Timeframes []domain.Timeframe
	Lookback   int
}

// MarketProcessor implements engine.Processor and enriches ExecutionContext.Market.
type MarketProcessor struct {
	service    *Service
	timeframes []domain.Timeframe
	lookback   int
}

// NewMarketProcessor returns a pipeline stage that fetches market snapshots.
func NewMarketProcessor(cfg ProcessorConfig) (*MarketProcessor, error) {
	if cfg.Service == nil {
		return nil, fmt.Errorf("market: service required")
	}
	lookback := cfg.Lookback
	if lookback <= 0 {
		lookback = defaultLookback
	}
	tfs := cfg.Timeframes
	if len(tfs) == 0 {
		tfs = []domain.Timeframe{domain.TF1H, domain.TF2H, domain.TF4H}
	}
	return &MarketProcessor{
		service:    cfg.Service,
		timeframes: tfs,
		lookback:   lookback,
	}, nil
}

// Name returns the processor identifier.
func (p *MarketProcessor) Name() string {
	return "market"
}

// Process fetches candle snapshots and sets ec.Market (primary TF) plus multi-TF metadata.
func (p *MarketProcessor) Process(ctx context.Context, ec *execctx.ExecutionContext) error {
	if ec == nil {
		return fmt.Errorf("market: nil execution context")
	}

	timeframes := p.timeframesFromContext(ec)
	primaryTF := ec.Timeframe
	if primaryTF.Minutes() == 0 {
		primaryTF = domain.TF1H
	}

	snaps, err := p.service.MultiSnapshot(ctx, ec.Symbol, timeframes, p.lookback)
	if err != nil {
		return fmt.Errorf("market: snapshot: %w", err)
	}

	if snap, ok := snaps[primaryTF]; ok {
		ec.Market = snap
	} else if len(snaps) > 0 {
		for _, tf := range timeframes {
			if snap, ok := snaps[tf]; ok {
				ec.Market = snap
				break
			}
		}
	}

	if ec.Metadata == nil {
		ec.Metadata = make(map[string]any)
	}
	ec.Metadata[MetadataKeyMarketByTF] = snaps

	return nil
}

func (p *MarketProcessor) timeframesFromContext(ec *execctx.ExecutionContext) []domain.Timeframe {
	if ec.Metadata != nil {
		if raw, ok := ec.Metadata[MetadataKeyTimeframes]; ok {
			switch v := raw.(type) {
			case []domain.Timeframe:
				return v
			case []string:
				out := make([]domain.Timeframe, 0, len(v))
				for _, s := range v {
					tf, err := domain.ParseTimeframe(s)
					if err == nil {
						out = append(out, tf)
					}
				}
				if len(out) > 0 {
					return out
				}
			}
		}
	}
	return p.timeframes
}

// Compile-time check that MarketProcessor implements engine.Processor.
var _ engine.Processor = (*MarketProcessor)(nil)
