package scheduler

import (
	"context"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// JobType identifies a scheduled job category.
type JobType string

const (
	// JobCandleClosed fires when an IST-aligned bar closes (1H / 2H / 4H).
	JobCandleClosed JobType = "candle_closed"

	// JobTrailingCheck fires periodic trailing-stop evaluation for open trades.
	JobTrailingCheck JobType = "trailing_check"

	// JobDailyReport fires end-of-day reporting (e.g. 23:35 IST).
	JobDailyReport JobType = "daily_report"

	// JobSessionToken fires once per day before market open to ensure a valid Flattrade jKey.
	// Analogous to EventBridge → Lambda token refresh; Atlas stores the token in Redis.
	JobSessionToken JobType = "session_token"
)

// Job is a unit of scheduled work. The scheduler decides when to fire; handlers
// publish events or trigger workflows — no business logic here.
type Job struct {
	Type      JobType
	Symbol    string // optional
	Timeframe domain.Timeframe
	FireAt    time.Time
	Metadata  map[string]string
}

// Handler runs when a job fires. Handlers must not perform business logic;
// they should publish events or enqueue workflows only.
type Handler func(ctx context.Context, job Job) error

// CandleClosedPayload is published on the event bus for NewCandle events.
type CandleClosedPayload struct {
	Symbol    string
	Timeframe domain.Timeframe
	CloseAt   time.Time
}
