package market

import (
	"context"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// Provider fetches OHLCV candles for a symbol at a given timeframe.
// Implementations may only support a base timeframe (e.g. TF1H from Flattrade);
// the Service aggregates higher timeframes when needed.
type Provider interface {
	Name() string
	FetchCandles(ctx context.Context, symbol domain.Symbol, tf domain.Timeframe, from, to time.Time) ([]domain.Candle, error)
}
