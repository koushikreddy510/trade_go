package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// NewRedisClient returns a go-redis client for the given address and DB index.
func NewRedisClient(addr string, db int) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:         addr,
		DB:           db,
		MaxRetries:   1,
		DialTimeout:  500 * time.Millisecond,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	})
}

// Ping checks Redis connectivity.
func Ping(ctx context.Context, client redis.Cmdable) error {
	if err := client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}
