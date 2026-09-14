// Package instruments resolves exchange futures contracts (e.g. MCX SILVERMIC)
// to the correct token/tsym for the trading month — same idea as the older
// Lambda SearchScrip + get_next_x_fut logic.
package instruments

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/koushik-bangaru/atlas/internal/scheduler"
)

// Month names as used in MCX / Flattrade trading symbols (e.g. SILVERMIC26SEP30).
var monthCodes = []string{
	"JAN", "FEB", "MAR", "APR", "MAY", "JUN",
	"JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
}

// Policy selects which forward month to trade.
type Policy string

const (
	// PolicyFixed always uses MonthOffset months ahead of "now" (default: 2).
	PolicyFixed Policy = "fixed"

	// PolicySmart:
	//   - calendar day 1–10  → next month (offset 1)
	//   - last 7 days of month → current+2 (offset 2)
	//   - otherwise → next month (offset 1)
	PolicySmart Policy = "smart"
)

// Contract is a resolved futures instrument.
type Contract struct {
	Exchange string
	Token    string
	Tsym     string
	Root     string
	Month    time.Month
	Year     int
	Offset   int
}

// Candidate is one SearchScrip / master row before selection.
type Candidate struct {
	Exchange string
	Token    string
	Tsym     string
	InstName string // e.g. FUTCOM
	PP       string
	TickSize string
	LotSize  string
}

// SelectConfig controls futures month picking.
type SelectConfig struct {
	Root        string // e.g. SILVERMIC — prefix of tsym
	Policy      Policy
	MonthOffset int // used when PolicyFixed (default 2)
	NearExpiryDays int // for PolicySmart, default 7
	InstFilter  string // e.g. FUTCOM; empty = no filter
}

// DefaultSelectConfig returns fixed +2 months for SILVERMIC-style roots.
func DefaultSelectConfig(root string) SelectConfig {
	return SelectConfig{
		Root:           root,
		Policy:         PolicyFixed,
		MonthOffset:    2,
		NearExpiryDays: 7,
		InstFilter:     "FUTCOM",
	}
}

// ResolveOffset returns the month offset to use for now under cfg.Policy.
func ResolveOffset(cfg SelectConfig, now time.Time) int {
	now = now.In(scheduler.IST)
	switch cfg.Policy {
	case PolicySmart:
		near := cfg.NearExpiryDays
		if near <= 0 {
			near = 7
		}
		day := now.Day()
		lastDay := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, scheduler.IST).Day()
		if day <= 10 {
			return 1
		}
		if day > lastDay-near {
			return 2
		}
		return 1
	default: // fixed
		if cfg.MonthOffset < 0 {
			return 0
		}
		return cfg.MonthOffset
	}
}

// TargetYearMonth returns calendar year/month for now + offset months.
func TargetYearMonth(now time.Time, offset int) (year int, month time.Month) {
	now = now.In(scheduler.IST)
	t := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, scheduler.IST).AddDate(0, offset, 0)
	return t.Year(), t.Month()
}

// MonthCode returns JAN..DEC for m.
func MonthCode(m time.Month) string {
	i := int(m) - 1
	if i < 0 || i >= len(monthCodes) {
		return ""
	}
	return monthCodes[i]
}

// MatchTsym reports whether tsym is a futures contract for root in year/month.
// Pattern (legacy Lambda): ^ROOT YY MON DD  e.g. SILVERMIC26SEP30
func MatchTsym(tsym, root string, year int, month time.Month) bool {
	tsym = strings.ToUpper(strings.TrimSpace(tsym))
	root = strings.ToUpper(strings.TrimSpace(root))
	if root == "" || tsym == "" {
		return false
	}
	yy := year % 100
	mon := MonthCode(month)
	re := regexp.MustCompile(fmt.Sprintf(`^%s%02d%s\d{2}`, regexp.QuoteMeta(root), yy, mon))
	return re.MatchString(tsym)
}

// FilterFutures keeps FUTCOM (or InstFilter) rows; if InstFilter empty and InstName
// empty on all rows, keeps all (SearchScrip may omit instname).
func FilterFutures(cands []Candidate, instFilter string) []Candidate {
	instFilter = strings.ToUpper(strings.TrimSpace(instFilter))
	if instFilter == "" {
		return append([]Candidate(nil), cands...)
	}
	out := make([]Candidate, 0, len(cands))
	anyInst := false
	for _, c := range cands {
		if strings.TrimSpace(c.InstName) != "" {
			anyInst = true
			break
		}
	}
	for _, c := range cands {
		if !anyInst {
			// No instname in payload — keep roots that look like futures tsyms.
			out = append(out, c)
			continue
		}
		if strings.EqualFold(c.InstName, instFilter) {
			out = append(out, c)
		}
	}
	return out
}

// SelectContract picks the futures matching cfg for "now".
// If the preferred month is empty, it walks forward month-by-month (like the
// old while(Object.keys(get_fut_obj).length===0) x++ loop), up to 12 steps.
func SelectContract(cands []Candidate, cfg SelectConfig, now time.Time) (Contract, error) {
	root := strings.ToUpper(strings.TrimSpace(cfg.Root))
	if root == "" {
		return Contract{}, fmt.Errorf("instruments: futures root required")
	}

	filtered := FilterFutures(cands, cfg.InstFilter)
	if len(filtered) == 0 {
		return Contract{}, fmt.Errorf("instruments: no futures candidates for root %s", root)
	}

	startOffset := ResolveOffset(cfg, now)
	for step := 0; step < 12; step++ {
		offset := startOffset + step
		year, month := TargetYearMonth(now, offset)
		matches := make([]Candidate, 0)
		for _, c := range filtered {
			if MatchTsym(c.Tsym, root, year, month) {
				matches = append(matches, c)
			}
		}
		if len(matches) == 0 {
			continue
		}
		// Prefer first match (same as Lambda get_fut_obj[0]).
		best := matches[0]
		lot, _ := strconv.Atoi(best.LotSize)
		_ = lot
		exch := best.Exchange
		if exch == "" {
			exch = "MCX"
		}
		return Contract{
			Exchange: exch,
			Token:    best.Token,
			Tsym:     best.Tsym,
			Root:     root,
			Month:    month,
			Year:     year,
			Offset:   offset,
		}, nil
	}
	return Contract{}, fmt.Errorf("instruments: no matching %s futures for offset>=%d from %s",
		root, startOffset, now.In(scheduler.IST).Format("2006-01-02"))
}
