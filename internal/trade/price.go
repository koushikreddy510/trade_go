package trade

import (
	"strconv"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

const (
	MetadataEntryPrice = "entry_price"
	MetadataExitPrice  = "exit_price"
	MetadataTarget     = "target"
)

func entryPrice(sig domain.Signal, marketClose float64) float64 {
	if sig.Metadata != nil {
		if raw, ok := sig.Metadata[MetadataEntryPrice]; ok {
			if p, err := strconv.ParseFloat(raw, 64); err == nil && p > 0 {
				return p
			}
		}
	}
	return marketClose
}

func targetFromSignal(sig domain.Signal) float64 {
	if sig.Metadata == nil {
		return 0
	}
	raw, ok := sig.Metadata[MetadataTarget]
	if !ok {
		return 0
	}
	p, err := strconv.ParseFloat(raw, 64)
	if err != nil || p <= 0 {
		return 0
	}
	return p
}

func exitPrice(sig domain.Signal, marketClose float64) float64 {
	if sig.Metadata != nil {
		if raw, ok := sig.Metadata[MetadataExitPrice]; ok {
			if p, err := strconv.ParseFloat(raw, 64); err == nil && p > 0 {
				return p
			}
		}
	}
	return marketClose
}

func lastClose(market domain.MarketSnapshot) float64 {
	n := len(market.Candles)
	if n == 0 {
		return 0
	}
	return market.Candles[n-1].Close
}

func lastCandle(market domain.MarketSnapshot) (domain.Candle, bool) {
	n := len(market.Candles)
	if n == 0 {
		return domain.Candle{}, false
	}
	return market.Candles[n-1], true
}
