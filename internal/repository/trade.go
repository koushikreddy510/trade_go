package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/redis/go-redis/v9"
)

// ErrTradeNotFound is returned when a trade ID does not exist in the repository.
var ErrTradeNotFound = errors.New("trade not found")

// TradeRepository persists trade aggregates and indexes.
type TradeRepository interface {
	Save(ctx context.Context, t *domain.Trade) error
	Update(ctx context.Context, t *domain.Trade) error
	Find(ctx context.Context, id string) (*domain.Trade, error)
	Active(ctx context.Context) ([]domain.Trade, error)
	ByStrategy(ctx context.Context, strategyID string) ([]domain.Trade, error)
	DeleteActive(ctx context.Context, id string) error
}

// RedisTradeRepository stores trades in Redis using JSON strings and aggregate indexes.
type RedisTradeRepository struct {
	client redis.Cmdable
}

// NewRedisTradeRepository returns a Redis-backed trade repository.
func NewRedisTradeRepository(client redis.Cmdable) *RedisTradeRepository {
	return &RedisTradeRepository{client: client}
}

func (r *RedisTradeRepository) Save(ctx context.Context, t *domain.Trade) error {
	if t == nil {
		return fmt.Errorf("trade is nil")
	}

	payload, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("marshal trade: %w", err)
	}

	pipe := r.client.Pipeline()
	pipe.Set(ctx, TradeKey(t.TradeID), payload, 0)
	pipe.SAdd(ctx, StrategyTradesKey(t.StrategyID), t.TradeID)

	if t.State == domain.TradeStateOpen {
		score := activeScore(t)
		pipe.ZAdd(ctx, ActiveTradesKey(), redis.Z{Score: score, Member: t.TradeID})
		pipe.Set(ctx, PositionKey(t.StrategyID, t.Symbol.Exchange, t.Symbol.Token), t.TradeID, 0)
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("save trade: %w", err)
	}
	return nil
}

func (r *RedisTradeRepository) Update(ctx context.Context, t *domain.Trade) error {
	if t == nil {
		return fmt.Errorf("trade is nil")
	}

	exists, err := r.client.Exists(ctx, TradeKey(t.TradeID)).Result()
	if err != nil {
		return fmt.Errorf("check trade exists: %w", err)
	}
	if exists == 0 {
		return ErrTradeNotFound
	}

	payload, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("marshal trade: %w", err)
	}

	if err := r.client.Set(ctx, TradeKey(t.TradeID), payload, 0).Err(); err != nil {
		return fmt.Errorf("update trade: %w", err)
	}
	return nil
}

func (r *RedisTradeRepository) Find(ctx context.Context, id string) (*domain.Trade, error) {
	payload, err := r.client.Get(ctx, TradeKey(id)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrTradeNotFound
		}
		return nil, fmt.Errorf("get trade: %w", err)
	}

	var trade domain.Trade
	if err := json.Unmarshal(payload, &trade); err != nil {
		return nil, fmt.Errorf("unmarshal trade: %w", err)
	}
	return &trade, nil
}

func (r *RedisTradeRepository) Active(ctx context.Context) ([]domain.Trade, error) {
	ids, err := r.client.ZRange(ctx, ActiveTradesKey(), 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("list active trades: %w", err)
	}

	out := make([]domain.Trade, 0, len(ids))
	for _, id := range ids {
		trade, err := r.Find(ctx, id)
		if err != nil {
			if errors.Is(err, ErrTradeNotFound) {
				continue
			}
			return nil, err
		}
		if trade.State == domain.TradeStateOpen {
			out = append(out, *trade)
		}
	}
	return out, nil
}

func (r *RedisTradeRepository) ByStrategy(ctx context.Context, strategyID string) ([]domain.Trade, error) {
	ids, err := r.client.SMembers(ctx, StrategyTradesKey(strategyID)).Result()
	if err != nil {
		return nil, fmt.Errorf("list strategy trades: %w", err)
	}

	out := make([]domain.Trade, 0, len(ids))
	for _, id := range ids {
		trade, err := r.Find(ctx, id)
		if err != nil {
			if errors.Is(err, ErrTradeNotFound) {
				continue
			}
			return nil, err
		}
		out = append(out, *trade)
	}
	return out, nil
}

func (r *RedisTradeRepository) DeleteActive(ctx context.Context, id string) error {
	trade, err := r.Find(ctx, id)
	if err != nil {
		return err
	}

	pipe := r.client.Pipeline()
	pipe.ZRem(ctx, ActiveTradesKey(), id)
	pipe.Del(ctx, PositionKey(trade.StrategyID, trade.Symbol.Exchange, trade.Symbol.Token))

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete active trade: %w", err)
	}
	return nil
}

// MemoryTradeRepository is an in-memory TradeRepository for tests.
type MemoryTradeRepository struct {
	trades   map[string]*domain.Trade
	active   map[string]struct{}
	byStrat  map[string]map[string]struct{}
	positions map[string]string
}

// NewMemoryTradeRepository returns an empty in-memory trade repository.
func NewMemoryTradeRepository() *MemoryTradeRepository {
	return &MemoryTradeRepository{
		trades:    make(map[string]*domain.Trade),
		active:    make(map[string]struct{}),
		byStrat:   make(map[string]map[string]struct{}),
		positions: make(map[string]string),
	}
}

func (m *MemoryTradeRepository) Save(_ context.Context, t *domain.Trade) error {
	if t == nil {
		return fmt.Errorf("trade is nil")
	}

	cp := cloneTrade(t)
	m.trades[t.TradeID] = cp

	if m.byStrat[t.StrategyID] == nil {
		m.byStrat[t.StrategyID] = make(map[string]struct{})
	}
	m.byStrat[t.StrategyID][t.TradeID] = struct{}{}

	if t.State == domain.TradeStateOpen {
		m.active[t.TradeID] = struct{}{}
		posKey := PositionKey(t.StrategyID, t.Symbol.Exchange, t.Symbol.Token)
		m.positions[posKey] = t.TradeID
	}
	return nil
}

func (m *MemoryTradeRepository) Update(_ context.Context, t *domain.Trade) error {
	if t == nil {
		return fmt.Errorf("trade is nil")
	}
	if _, ok := m.trades[t.TradeID]; !ok {
		return ErrTradeNotFound
	}
	m.trades[t.TradeID] = cloneTrade(t)
	return nil
}

func (m *MemoryTradeRepository) Find(_ context.Context, id string) (*domain.Trade, error) {
	trade, ok := m.trades[id]
	if !ok {
		return nil, ErrTradeNotFound
	}
	return cloneTrade(trade), nil
}

func (m *MemoryTradeRepository) Active(_ context.Context) ([]domain.Trade, error) {
	out := make([]domain.Trade, 0, len(m.active))
	for id := range m.active {
		trade, ok := m.trades[id]
		if !ok || trade.State != domain.TradeStateOpen {
			continue
		}
		out = append(out, *cloneTrade(trade))
	}
	return out, nil
}

func (m *MemoryTradeRepository) ByStrategy(_ context.Context, strategyID string) ([]domain.Trade, error) {
	ids, ok := m.byStrat[strategyID]
	if !ok {
		return nil, nil
	}

	out := make([]domain.Trade, 0, len(ids))
	for id := range ids {
		trade, ok := m.trades[id]
		if !ok {
			continue
		}
		out = append(out, *cloneTrade(trade))
	}
	return out, nil
}

func (m *MemoryTradeRepository) DeleteActive(_ context.Context, id string) error {
	trade, ok := m.trades[id]
	if !ok {
		return ErrTradeNotFound
	}

	delete(m.active, id)
	posKey := PositionKey(trade.StrategyID, trade.Symbol.Exchange, trade.Symbol.Token)
	delete(m.positions, posKey)
	return nil
}

func activeScore(t *domain.Trade) float64 {
	if !t.Position.EntryTime.IsZero() {
		return float64(t.Position.EntryTime.Unix())
	}
	return float64(time.Now().Unix())
}

func cloneTrade(t *domain.Trade) *domain.Trade {
	if t == nil {
		return nil
	}
	cp := *t
	if len(t.Metadata) > 0 {
		cp.Metadata = make(map[string]string, len(t.Metadata))
		for k, v := range t.Metadata {
			cp.Metadata[k] = v
		}
	}
	return &cp
}
