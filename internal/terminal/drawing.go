// Package terminal contains the read-only, paper-safe API that backs the Atlas
// trading terminal. Execution remains in the existing workflow pipeline.
package terminal

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/redis/go-redis/v9"
)

// Drawing is a user-created chart annotation. Coordinates are epoch seconds
// and prices, allowing the browser to render it at any screen resolution.
type Drawing struct {
	ID        string        `json:"id"`
	Kind      string        `json:"kind"` // trend_line, horizontal_line, channel
	Symbol    domain.Symbol `json:"symbol"`
	Timeframe string        `json:"timeframe"`
	Points    []Point       `json:"points"`
	Label     string        `json:"label,omitempty"`
	Color     string        `json:"color,omitempty"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// Point is one price/time coordinate in a drawing.
type Point struct {
	Time  int64   `json:"time"`
	Price float64 `json:"price"`
}

// DrawingStore persists drawings by a logical user identity.
type DrawingStore interface {
	List(context.Context, string, domain.Symbol, domain.Timeframe) ([]Drawing, error)
	Save(context.Context, string, Drawing) error
	Delete(context.Context, string, domain.Symbol, domain.Timeframe, string) error
}

// MemoryDrawingStore is intended for local development when Redis is absent.
type MemoryDrawingStore struct {
	mu   sync.RWMutex
	data map[string]Drawing
}

func NewMemoryDrawingStore() *MemoryDrawingStore {
	return &MemoryDrawingStore{data: make(map[string]Drawing)}
}

func (s *MemoryDrawingStore) List(_ context.Context, user string, symbol domain.Symbol, tf domain.Timeframe) ([]Drawing, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Drawing, 0)
	for _, d := range s.data {
		if drawingKey(user, d.Symbol, mustTimeframe(d.Timeframe), d.ID) == drawingKey(user, symbol, tf, d.ID) {
			out = append(out, cloneDrawing(d))
		}
	}
	sortDrawings(out)
	return out, nil
}

func (s *MemoryDrawingStore) Save(_ context.Context, user string, d Drawing) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[drawingKey(user, d.Symbol, mustTimeframe(d.Timeframe), d.ID)] = cloneDrawing(d)
	return nil
}

func (s *MemoryDrawingStore) Delete(_ context.Context, user string, symbol domain.Symbol, tf domain.Timeframe, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, drawingKey(user, symbol, tf, id))
	return nil
}

// RedisDrawingStore provides Redis-backed drawing persistence. It deliberately
// stores one drawing per key so changes do not overwrite another chart edit.
type RedisDrawingStore struct{ client redis.Cmdable }

func NewRedisDrawingStore(client redis.Cmdable) *RedisDrawingStore {
	return &RedisDrawingStore{client: client}
}

func (s *RedisDrawingStore) List(ctx context.Context, user string, symbol domain.Symbol, tf domain.Timeframe) ([]Drawing, error) {
	keys, err := s.client.Keys(ctx, drawingPrefix(user, symbol, tf)+"*").Result()
	if err != nil {
		return nil, err
	}
	out := make([]Drawing, 0, len(keys))
	for _, key := range keys {
		var d Drawing
		payload, err := s.client.Get(ctx, key).Bytes()
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &d); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	sortDrawings(out)
	return out, nil
}

func (s *RedisDrawingStore) Save(ctx context.Context, user string, d Drawing) error {
	payload, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, drawingKey(user, d.Symbol, mustTimeframe(d.Timeframe), d.ID), payload, 0).Err()
}

func (s *RedisDrawingStore) Delete(ctx context.Context, user string, symbol domain.Symbol, tf domain.Timeframe, id string) error {
	return s.client.Del(ctx, drawingKey(user, symbol, tf, id)).Err()
}

func drawingPrefix(user string, symbol domain.Symbol, tf domain.Timeframe) string {
	return "atlas:chart:drawing:" + user + ":" + symbol.Exchange + ":" + symbol.Token + ":" + tf.String() + ":"
}
func drawingKey(user string, symbol domain.Symbol, tf domain.Timeframe, id string) string {
	return drawingPrefix(user, symbol, tf) + id
}
func mustTimeframe(value string) domain.Timeframe { tf, _ := domain.ParseTimeframe(value); return tf }
func cloneDrawing(d Drawing) Drawing              { d.Points = append([]Point(nil), d.Points...); return d }
func sortDrawings(v []Drawing)                    { sort.Slice(v, func(i, j int) bool { return v[i].ID < v[j].ID }) }

var ErrInvalidDrawing = errors.New("terminal: invalid drawing")
