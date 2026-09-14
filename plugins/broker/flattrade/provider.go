package flattrade

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

// MarketProvider adapts the Flattrade client to market.Provider.
type MarketProvider struct {
	client *Client
}

// NewMarketProvider returns a market.Provider backed by a Flattrade client.
func NewMarketProvider(client *Client) *MarketProvider {
	return &MarketProvider{client: client}
}

// Name returns the provider identifier.
func (p *MarketProvider) Name() string {
	return "flattrade"
}

// FetchCandles fetches candles from TPSeries. TF4H is not supported directly — use market.Service aggregation.
func (p *MarketProvider) FetchCandles(ctx context.Context, symbol domain.Symbol, tf domain.Timeframe, from, to time.Time) ([]domain.Candle, error) {
	if p.client.SessionToken() == "" {
		return nil, ErrNotConfigured
	}

	intrv, err := timeframeToInterval(tf)
	if err != nil {
		return nil, err
	}

	req := TPSeriesRequest{
		Exch:  symbol.Exchange,
		Token: symbol.Token,
		Start: fmt.Sprintf("%d", from.Unix()),
		End:   fmt.Sprintf("%d", to.Unix()),
		Intrv: intrv,
	}

	raw, err := p.client.TPSeries(ctx, req)
	if err != nil {
		return nil, err
	}

	out := make([]domain.Candle, 0, len(raw))
	for _, c := range raw {
		dc, err := convertCandle(c)
		if err != nil {
			return nil, fmt.Errorf("flattrade: convert candle: %w", err)
		}
		out = append(out, dc)
	}
	return out, nil
}

func timeframeToInterval(tf domain.Timeframe) (Interval, error) {
	switch tf {
	case domain.TF1H:
		return Interval1H, nil
	case domain.TF2H:
		return Interval2H, nil
	case domain.TF4H:
		return "", fmt.Errorf("flattrade: TF4H not supported — fetch 1H and aggregate")
	default:
		return "", fmt.Errorf("flattrade: unsupported timeframe %s", tf)
	}
}

func convertCandle(c Candle) (domain.Candle, error) {
	t, err := ParseCandleTime(c.Time)
	if err != nil {
		return domain.Candle{}, err
	}

	open, err := parseFloat(c.Into)
	if err != nil {
		return domain.Candle{}, fmt.Errorf("into: %w", err)
	}
	high, err := parseFloat(c.Inth)
	if err != nil {
		return domain.Candle{}, fmt.Errorf("inth: %w", err)
	}
	low, err := parseFloat(c.Intl)
	if err != nil {
		return domain.Candle{}, fmt.Errorf("intl: %w", err)
	}
	close, err := parseFloat(c.Intc)
	if err != nil {
		return domain.Candle{}, fmt.Errorf("intc: %w", err)
	}
	vol, err := parseInt64(c.Intv)
	if err != nil {
		return domain.Candle{}, fmt.Errorf("intv: %w", err)
	}

	dc := domain.Candle{
		Time:   t,
		Open:   open,
		High:   high,
		Low:    low,
		Close:  close,
		Volume: vol,
	}

	if c.OI != "" {
		oi, err := parseInt64(c.OI)
		if err != nil {
			return domain.Candle{}, fmt.Errorf("oi: %w", err)
		}
		dc.OI = &oi
	}

	return dc, nil
}

func parseFloat(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	return strconv.ParseFloat(s, 64)
}

func parseInt64(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	return strconv.ParseInt(s, 10, 64)
}

// ParseCandleTime parses Flattrade TPSeries bar timestamps.
// Supported formats: DD-MM-YYYY HH:MM:SS and DD/MM/YYYY HH:MM:SS.
func ParseCandleTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, fmt.Errorf("flattrade: empty candle time")
	}

	layouts := []string{
		"02-01-2006 15:04:05",
		"02/01/2006 15:04:05",
		"02-01-2006 15:04:05 MST",
		"02/01/2006 15:04:05 MST",
	}

	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("flattrade: unparseable candle time %q", s)
}
