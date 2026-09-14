package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrTokenNotFound is returned when a token key does not exist.
var ErrTokenNotFound = errors.New("token not found")

// TokenStore persists short-lived broker auth tokens.
type TokenStore interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, token string, ttl time.Duration) error
}

// RedisTokenStore stores tokens in Redis with optional TTL.
type RedisTokenStore struct {
	client redis.Cmdable
}

// NewRedisTokenStore returns a Redis-backed token store.
func NewRedisTokenStore(client redis.Cmdable) *RedisTokenStore {
	return &RedisTokenStore{client: client}
}

func (s *RedisTokenStore) Get(ctx context.Context, key string) (string, error) {
	val, err := s.client.Get(ctx, key).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", ErrTokenNotFound
		}
		return "", fmt.Errorf("get token: %w", err)
	}
	return val, nil
}

func (s *RedisTokenStore) Set(ctx context.Context, key string, token string, ttl time.Duration) error {
	if err := s.client.Set(ctx, key, token, ttl).Err(); err != nil {
		return fmt.Errorf("set token: %w", err)
	}
	return nil
}

type memoryTokenEntry struct {
	value     string
	expiresAt time.Time
}

// MemoryTokenStore is an in-memory TokenStore for tests.
type MemoryTokenStore struct {
	mu     sync.RWMutex
	tokens map[string]memoryTokenEntry
}

// NewMemoryTokenStore returns an empty in-memory token store.
func NewMemoryTokenStore() *MemoryTokenStore {
	return &MemoryTokenStore{
		tokens: make(map[string]memoryTokenEntry),
	}
}

func (s *MemoryTokenStore) Get(_ context.Context, key string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.tokens[key]
	if !ok {
		return "", ErrTokenNotFound
	}
	if !entry.expiresAt.IsZero() && time.Now().After(entry.expiresAt) {
		return "", ErrTokenNotFound
	}
	return entry.value, nil
}

func (s *MemoryTokenStore) Set(_ context.Context, key string, token string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := memoryTokenEntry{value: token}
	if ttl > 0 {
		entry.expiresAt = time.Now().Add(ttl)
	}
	s.tokens[key] = entry
	return nil
}
