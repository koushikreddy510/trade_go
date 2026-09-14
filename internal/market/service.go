package market

import (
	"context"
	"fmt"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

const defaultCacheSize = 500

// ServiceOption configures a Service.
type ServiceOption func(*Service)

// WithCacheSize sets the maximum number of candles retained per symbol+timeframe.
func WithCacheSize(n int) ServiceOption {
	return func(s *Service) {
		if n > 0 {
			s.maxCache = n
		}
	}
}

// WithBaseTimeframe sets the provider's native timeframe (default TF1H).
func WithBaseTimeframe(tf domain.Timeframe) ServiceOption {
	return func(s *Service) {
		if tf.Minutes() > 0 {
			s.baseTF = tf
		}
	}
}

// Service fetches candles from a Provider, aggregates higher timeframes, and caches results.
type Service struct {
	provider Provider
	baseTF   domain.Timeframe
	maxCache int
	cache    map[string][]domain.Candle
}

// NewService returns a market data service backed by the given provider.
func NewService(provider Provider, opts ...ServiceOption) *Service {
	s := &Service{
		provider: provider,
		baseTF:   domain.TF1H,
		maxCache: defaultCacheSize,
		cache:    make(map[string][]domain.Candle),
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// Snapshot returns the latest lookback candles for symbol at tf.
func (s *Service) Snapshot(ctx context.Context, symbol domain.Symbol, tf domain.Timeframe, lookback int) (domain.MarketSnapshot, error) {
	if lookback <= 0 {
		return domain.MarketSnapshot{}, fmt.Errorf("market: lookback must be positive")
	}

	candles, err := s.fetchAndCache(ctx, symbol, tf, lookback)
	if err != nil {
		return domain.MarketSnapshot{}, err
	}

	if len(candles) > lookback {
		candles = candles[len(candles)-lookback:]
	}

	return domain.MarketSnapshot{
		Symbol:    symbol,
		Timeframe: tf,
		Candles:   candles,
	}, nil
}

// MultiSnapshot returns snapshots for multiple timeframes for the same symbol.
func (s *Service) MultiSnapshot(ctx context.Context, symbol domain.Symbol, timeframes []domain.Timeframe, lookback int) (map[domain.Timeframe]domain.MarketSnapshot, error) {
	out := make(map[domain.Timeframe]domain.MarketSnapshot, len(timeframes))
	for _, tf := range timeframes {
		snap, err := s.Snapshot(ctx, symbol, tf, lookback)
		if err != nil {
			return nil, err
		}
		out[tf] = snap
	}
	return out, nil
}

func (s *Service) fetchAndCache(ctx context.Context, symbol domain.Symbol, tf domain.Timeframe, lookback int) ([]domain.Candle, error) {
	key := cacheKey(symbol, tf)

	if cached, ok := s.cache[key]; ok && len(cached) >= lookback {
		return cached, nil
	}

	candles, err := s.resolveTimeframe(ctx, symbol, tf, lookback)
	if err != nil {
		return nil, err
	}

	if len(candles) > s.maxCache {
		candles = candles[len(candles)-s.maxCache:]
	}
	s.cache[key] = candles
	return candles, nil
}

func (s *Service) resolveTimeframe(ctx context.Context, symbol domain.Symbol, tf domain.Timeframe, lookback int) ([]domain.Candle, error) {
	if tf == s.baseTF {
		return s.fetchFromProvider(ctx, symbol, tf, lookback)
	}

	if tf.Minutes() > s.baseTF.Minutes() && tf.Minutes()%s.baseTF.Minutes() == 0 {
		ratio := tf.Minutes() / s.baseTF.Minutes()
		baseLookback := lookback*ratio + ratio // extra base bars for partial-bucket tolerance
		base, err := s.fetchFromProvider(ctx, symbol, s.baseTF, baseLookback)
		if err != nil {
			return nil, err
		}
		agg, err := domain.AggregateCandlesPartial(base, s.baseTF, tf)
		if err != nil {
			return nil, fmt.Errorf("market: aggregate %s→%s: %w", s.baseTF, tf, err)
		}
		return agg, nil
	}

	return s.fetchFromProvider(ctx, symbol, tf, lookback)
}

func (s *Service) fetchFromProvider(ctx context.Context, symbol domain.Symbol, tf domain.Timeframe, lookback int) ([]domain.Candle, error) {
	dur := tf.Duration()
	from := time.Now().Add(-time.Duration(lookback+1) * dur)
	to := time.Now()

	candles, err := s.provider.FetchCandles(ctx, symbol, tf, from, to)
	if err != nil {
		return nil, err
	}
	return candles, nil
}

func cacheKey(symbol domain.Symbol, tf domain.Timeframe) string {
	return symbol.Exchange + ":" + symbol.Token + ":" + tf.String()
}
