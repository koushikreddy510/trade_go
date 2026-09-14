package repository

import "fmt"

const keyPrefix = "atlas:"

// TradeKey returns the Redis key for a trade aggregate by ID.
func TradeKey(id string) string {
	return keyPrefix + "trade:" + id
}

// ActiveTradesKey returns the sorted set key for active trades.
func ActiveTradesKey() string {
	return keyPrefix + "trade:active"
}

// StrategyTradesKey returns the set key for all trades owned by a strategy.
func StrategyTradesKey(strategyID string) string {
	return keyPrefix + "strategy:" + strategyID + ":trades"
}

// PositionKey returns the key mapping strategy+instrument to an active trade ID.
func PositionKey(strategyID, exchange, token string) string {
	return fmt.Sprintf("%sposition:%s:%s:%s", keyPrefix, strategyID, exchange, token)
}

// ConfigCurrentKey returns the key for the active compiled configuration blob.
func ConfigCurrentKey() string {
	return keyPrefix + "config:current"
}

// FlattradeTokenKey returns the key for the cached Flattrade jKey token.
func FlattradeTokenKey() string {
	return keyPrefix + "broker:flattrade:token"
}
