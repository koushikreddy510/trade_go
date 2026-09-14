package price_test

import (
	"testing"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/plugins/trailing/price"
)

func TestPriceTrailUsesEMAWhenHigher(t *testing.T) {
	t.Parallel()

	policy := price.PriceTrail{TrailPoints: 2}
	newSL, changed := policy.NextStopLoss(domain.Trade{
		Side: domain.SideBuy,
		Risk: domain.RiskState{StopLoss: 95},
	}, 104, 103)

	if !changed {
		t.Fatal("expected trailing change")
	}
	if newSL != 103 {
		t.Fatalf("newSL = %v, want 103 (EMA floor)", newSL)
	}
}

func TestPriceTrailNoChangeWhenCloseUnchanged(t *testing.T) {
	t.Parallel()

	policy := price.PriceTrail{TrailPoints: 2}
	_, changed := policy.NextStopLoss(domain.Trade{
		Side: domain.SideBuy,
		Risk: domain.RiskState{StopLoss: 102},
	}, 103, 0)

	if changed {
		t.Fatal("expected no change when candidate SL is not higher")
	}
}
