package terminal

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/indicator"
	"github.com/koushik-bangaru/atlas/internal/market"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

// Service produces terminal read models. It never places, changes, or cancels
// orders; those operations stay in the execution pipeline.
type Service struct {
	market     *market.Service
	indicators *indicator.Engine
	trades     *trade.Manager
	drawings   DrawingStore
	symbol     domain.Symbol
	lookback   int
}

func NewService(m *market.Service, indicators *indicator.Engine, trades *trade.Manager, drawings DrawingStore, symbol domain.Symbol, lookback int) *Service {
	if lookback <= 0 {
		lookback = 200
	}
	return &Service{market: m, indicators: indicators, trades: trades, drawings: drawings, symbol: symbol, lookback: lookback}
}

type ChartSnapshot struct {
	Symbol      domain.Symbol                       `json:"symbol"`
	Timeframe   string                              `json:"timeframe"`
	Candles     []domain.Candle                     `json:"candles"`
	Indicators  map[string]domain.IndicatorSnapshot `json:"indicators"`
	Positions   []domain.Trade                      `json:"positions"`
	GeneratedAt time.Time                           `json:"generated_at"`
}

func (s *Service) Chart(ctx context.Context, tf domain.Timeframe) (ChartSnapshot, error) {
	if s == nil || s.market == nil || s.indicators == nil || s.trades == nil {
		return ChartSnapshot{}, fmt.Errorf("terminal: service not fully configured")
	}
	snap, err := s.market.Snapshot(ctx, s.symbol, tf, s.lookback)
	if err != nil {
		return ChartSnapshot{}, err
	}
	inds, err := s.indicators.ComputeAll(snap.Candles)
	if err != nil {
		return ChartSnapshot{}, err
	}
	for id, value := range inds {
		value.Symbol, value.Timeframe = s.symbol, tf
		inds[id] = value
	}
	positions := make([]domain.Trade, 0)
	for _, position := range s.trades.GetActive() {
		if position.Symbol == s.symbol {
			positions = append(positions, position)
		}
	}
	return ChartSnapshot{Symbol: s.symbol, Timeframe: tf.String(), Candles: snap.Candles, Indicators: inds, Positions: positions, GeneratedAt: time.Now().UTC()}, nil
}

func (s *Service) Drawings(ctx context.Context, user string, tf domain.Timeframe) ([]Drawing, error) {
	if s.drawings == nil {
		return nil, fmt.Errorf("terminal: drawing store unavailable")
	}
	return s.drawings.List(ctx, user, s.symbol, tf)
}

func (s *Service) SaveDrawing(ctx context.Context, user string, d Drawing) error {
	if s.drawings == nil {
		return fmt.Errorf("terminal: drawing store unavailable")
	}
	tf, err := domain.ParseTimeframe(d.Timeframe)
	if err != nil || d.ID == "" || !validDrawingKind(d.Kind) || len(d.Points) < 1 {
		return ErrInvalidDrawing
	}
	for _, p := range d.Points {
		if p.Time <= 0 || p.Price <= 0 {
			return ErrInvalidDrawing
		}
	}
	d.Symbol, d.Timeframe, d.UpdatedAt = s.symbol, tf.String(), time.Now().UTC()
	return s.drawings.Save(ctx, user, d)
}

func (s *Service) DeleteDrawing(ctx context.Context, user string, tf domain.Timeframe, id string) error {
	if s.drawings == nil || strings.TrimSpace(id) == "" {
		return ErrInvalidDrawing
	}
	return s.drawings.Delete(ctx, user, s.symbol, tf, id)
}

func validDrawingKind(kind string) bool {
	return kind == "trend_line" || kind == "horizontal_line" || kind == "channel"
}
