package trade

import "errors"

var (
	// ErrDuplicateOpen is returned when a strategy already has an open trade on the symbol.
	ErrDuplicateOpen = errors.New("trade: duplicate open for strategy+symbol")

	// ErrNoOpenTrade is returned when no matching open trade exists.
	ErrNoOpenTrade = errors.New("trade: no open trade")

	// ErrTradeNotFound is returned when the trade ID is unknown.
	ErrTradeNotFound = errors.New("trade: not found")

	// ErrInvalidSignal is returned for signals that cannot open or close a trade.
	ErrInvalidSignal = errors.New("trade: invalid signal")

	// ErrTradeNotOpen is returned when an operation requires an OPEN trade.
	ErrTradeNotOpen = errors.New("trade: not open")
)
