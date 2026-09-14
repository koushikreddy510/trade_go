package indicator

import (
	"fmt"
	"sort"
	"strings"

	"github.com/koushik-bangaru/atlas/plugins/indicators/ema"
	"github.com/koushik-bangaru/atlas/plugins/indicators/rsi"
	"github.com/koushik-bangaru/atlas/plugins/indicators/supertrend"
)

// NewEMA builds an EMA indicator plugin instance.
func NewEMA(id string, period int) (Indicator, error) {
	return ema.New(id, period)
}

// NewRSI builds an RSI indicator plugin instance.
func NewRSI(id string, period int) (Indicator, error) {
	return rsi.New(id, period)
}

// NewSupertrend builds a Supertrend indicator plugin instance.
func NewSupertrend(id string, period int, multiplier float64) (Indicator, error) {
	return supertrend.New(id, period, multiplier)
}

// instanceKey uniquely identifies an indicator by kind and parameters (excluding runtime id).
func instanceKey(name string, params map[string]float64) string {
	if len(params) == 0 {
		return name
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "direction" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys)+1)
	parts = append(parts, name)
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%v", k, params[k]))
	}
	return strings.Join(parts, "|")
}

// paramKeyFromIndicator extracts deduplication parameters from a registered indicator.
func paramKeyFromIndicator(ind Indicator) (string, map[string]float64, error) {
	snap, err := ind.Compute(nil)
	if err != nil {
		return "", nil, err
	}
	params := make(map[string]float64, len(snap.Parameters))
	for k, v := range snap.Parameters {
		if k == "direction" {
			continue
		}
		params[k] = v
	}
	return instanceKey(ind.Name(), params), params, nil
}
