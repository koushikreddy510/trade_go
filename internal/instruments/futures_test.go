package instruments_test

import (
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/instruments"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
)

func TestMatchTsym(t *testing.T) {
	t.Parallel()
	if !instruments.MatchTsym("SILVERMIC26SEP30", "SILVERMIC", 2026, time.September) {
		t.Fatal("expected match")
	}
	if instruments.MatchTsym("SILVERMIC26AUG30", "SILVERMIC", 2026, time.September) {
		t.Fatal("should not match August for September target")
	}
	if instruments.MatchTsym("SILVER26SEP30", "SILVERMIC", 2026, time.September) {
		t.Fatal("wrong root")
	}
}

func TestSelectContractFixedPlus2(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 15, 10, 0, 0, 0, scheduler.IST)
	cands := []instruments.Candidate{
		{Exchange: "MCX", Token: "1", Tsym: "SILVERMIC26JUL31", InstName: "FUTCOM"},
		{Exchange: "MCX", Token: "2", Tsym: "SILVERMIC26AUG31", InstName: "FUTCOM"},
		{Exchange: "MCX", Token: "3", Tsym: "SILVERMIC26SEP30", InstName: "FUTCOM"},
		{Exchange: "MCX", Token: "4", Tsym: "SILVERMIC26OCT30", InstName: "FUTCOM"},
		{Exchange: "MCX", Token: "99", Tsym: "SILVERMIC26SEP30C100000", InstName: "OPTCOM"},
	}
	cfg := instruments.SelectConfig{
		Root:        "SILVERMIC",
		Policy:      instruments.PolicyFixed,
		MonthOffset: 2,
		InstFilter:  "FUTCOM",
	}
	got, err := instruments.SelectContract(cands, cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	// July + 2 = September
	if got.Tsym != "SILVERMIC26SEP30" || got.Token != "3" {
		t.Fatalf("got %+v", got)
	}
	if got.Offset != 2 {
		t.Fatalf("offset=%d", got.Offset)
	}
}

func TestSelectContractWalkForwardWhenMissing(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 15, 10, 0, 0, 0, scheduler.IST)
	// No Sep — should walk to Oct (offset 3)
	cands := []instruments.Candidate{
		{Exchange: "MCX", Token: "1", Tsym: "SILVERMIC26JUL31", InstName: "FUTCOM"},
		{Exchange: "MCX", Token: "4", Tsym: "SILVERMIC26OCT30", InstName: "FUTCOM"},
	}
	cfg := instruments.SelectConfig{
		Root:        "SILVERMIC",
		Policy:      instruments.PolicyFixed,
		MonthOffset: 2,
		InstFilter:  "FUTCOM",
	}
	got, err := instruments.SelectContract(cands, cfg, now)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tsym != "SILVERMIC26OCT30" || got.Offset != 3 {
		t.Fatalf("got %+v", got)
	}
}

func TestResolveOffsetSmart(t *testing.T) {
	t.Parallel()
	cfg := instruments.SelectConfig{Policy: instruments.PolicySmart, NearExpiryDays: 7}

	early := time.Date(2026, time.August, 5, 0, 0, 0, 0, scheduler.IST)
	if off := instruments.ResolveOffset(cfg, early); off != 1 {
		t.Fatalf("early month offset=%d want 1", off)
	}

	late := time.Date(2026, time.August, 28, 0, 0, 0, 0, scheduler.IST)
	if off := instruments.ResolveOffset(cfg, late); off != 2 {
		t.Fatalf("near expiry offset=%d want 2", off)
	}

	mid := time.Date(2026, time.August, 15, 0, 0, 0, 0, scheduler.IST)
	if off := instruments.ResolveOffset(cfg, mid); off != 1 {
		t.Fatalf("mid month offset=%d want 1", off)
	}
}

func TestFilterFutures(t *testing.T) {
	t.Parallel()
	in := []instruments.Candidate{
		{Tsym: "A", InstName: "FUTCOM"},
		{Tsym: "B", InstName: "OPTCOM"},
	}
	out := instruments.FilterFutures(in, "FUTCOM")
	if len(out) != 1 || out[0].Tsym != "A" {
		t.Fatalf("%+v", out)
	}
}
