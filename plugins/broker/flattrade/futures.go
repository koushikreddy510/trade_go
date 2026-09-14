package flattrade

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/instruments"
)

// ResolveFutures searches MCX (or exchange) for root and selects the trading month
// contract using instruments.SelectContract — port of the old Lambda SearchScrip flow.
func (c *Client) ResolveFutures(ctx context.Context, exchange, searchText string, cfg instruments.SelectConfig, now time.Time) (instruments.Contract, error) {
	if c.sessionToken == "" {
		return instruments.Contract{}, ErrNotConfigured
	}
	if strings.TrimSpace(searchText) == "" {
		searchText = cfg.Root
	}
	if strings.TrimSpace(exchange) == "" {
		exchange = "MCX"
	}
	if cfg.Root == "" {
		cfg.Root = strings.ToUpper(strings.TrimSpace(searchText))
	}
	if cfg.InstFilter == "" {
		cfg.InstFilter = "FUTCOM"
	}

	resp, err := c.SearchScrip(ctx, SearchScripRequest{
		Exch:  exchange,
		SText: searchText,
	})
	if err != nil {
		return instruments.Contract{}, err
	}
	if resp == nil || len(resp.Values) == 0 {
		return instruments.Contract{}, fmt.Errorf("flattrade: SearchScrip returned no values for %q", searchText)
	}

	cands := make([]instruments.Candidate, 0, len(resp.Values))
	for _, v := range resp.Values {
		cands = append(cands, instruments.Candidate{
			Exchange: v.Exch,
			Token:    v.Token,
			Tsym:     v.Tsym,
			InstName: v.InstName,
			PP:       v.PP,
			TickSize: v.TI,
			LotSize:  v.LS,
		})
	}

	contract, err := instruments.SelectContract(cands, cfg, now)
	if err != nil {
		return instruments.Contract{}, err
	}
	if contract.Exchange == "" {
		contract.Exchange = exchange
	}
	return contract, nil
}

// ContractToSymbol maps a resolved futures contract to domain.Symbol.
func ContractToSymbol(c instruments.Contract, lotSize int, tick float64) domain.Symbol {
	if lotSize <= 0 {
		lotSize = 1
	}
	return domain.Symbol{
		Exchange: c.Exchange,
		Token:    c.Token,
		Name:     c.Tsym, // orders use full tsym
		LotSize:  lotSize,
		TickSize: tick,
	}
}

// ParseLotTick helpers for SearchScrip fields.
func ParseLotTick(lot, tick string) (int, float64) {
	ls, _ := strconv.Atoi(strings.TrimSpace(lot))
	ti, _ := strconv.ParseFloat(strings.TrimSpace(tick), 64)
	if ls <= 0 {
		ls = 1
	}
	return ls, ti
}
