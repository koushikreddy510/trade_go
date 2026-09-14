package market

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// FixtureCandle is the JSON representation of a candle in fixture files.
type FixtureCandle struct {
	Time   time.Time `json:"time"`
	Open   float64   `json:"open"`
	High   float64   `json:"high"`
	Low    float64   `json:"low"`
	Close  float64   `json:"close"`
	Volume int64     `json:"volume"`
	OI     *int64    `json:"oi,omitempty"`
}

// FixtureProvider serves candles from in-memory data keyed by symbol token.
type FixtureProvider struct {
	name string
	data map[string][]domain.Candle
}

// NewFixtureProvider loads candles from a JSON file.
// The file contains an array of FixtureCandle objects; all candles apply to the given symbol token.
func NewFixtureProvider(path string, token string) (*FixtureProvider, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("market: read fixture %s: %w", path, err)
	}

	var fixtures []FixtureCandle
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		return nil, fmt.Errorf("market: decode fixture %s: %w", path, err)
	}

	candles := make([]domain.Candle, len(fixtures))
	for i, f := range fixtures {
		candles[i] = domain.Candle{
			Time:   f.Time,
			Open:   f.Open,
			High:   f.High,
			Low:    f.Low,
			Close:  f.Close,
			Volume: f.Volume,
			OI:     f.OI,
		}
	}

	name := filepath.Base(path)
	return &FixtureProvider{
		name: "fixture:" + name,
		data: map[string][]domain.Candle{token: candles},
	}, nil
}

// NewSyntheticProvider generates a deterministic OHLC series for tests.
func NewSyntheticProvider(token string, count int, start time.Time, basePrice float64) *FixtureProvider {
	candles := make([]domain.Candle, count)
	for i := 0; i < count; i++ {
		t := start.Add(time.Duration(i) * time.Hour)
		open := basePrice + float64(i)*100
		high := open + 500
		low := open - 300
		close := open + 200
		candles[i] = domain.Candle{
			Time:   t,
			Open:   open,
			High:   high,
			Low:    low,
			Close:  close,
			Volume: int64(1000 + i*50),
		}
	}
	return &FixtureProvider{
		name: "fixture:synthetic",
		data: map[string][]domain.Candle{token: candles},
	}
}

// Name returns the provider identifier.
func (p *FixtureProvider) Name() string {
	return p.name
}

// FetchCandles returns all fixture candles for the symbol token.
// Fixtures ignore from/to — offline simulation serves the full static series.
func (p *FixtureProvider) FetchCandles(_ context.Context, symbol domain.Symbol, _ domain.Timeframe, _, _ time.Time) ([]domain.Candle, error) {
	candles, ok := p.data[symbol.Token]
	if !ok {
		return nil, fmt.Errorf("market: fixture: no data for token %s", symbol.Token)
	}
	return append([]domain.Candle(nil), candles...), nil
}

// SetCandles registers candles for a token (test helper).
func (p *FixtureProvider) SetCandles(token string, candles []domain.Candle) {
	p.data[token] = candles
}
