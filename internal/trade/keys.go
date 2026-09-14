package trade

import (
	"fmt"

	"github.com/koushik-bangaru/atlas/internal/domain"
)

func positionKey(strategyID string, sym domain.Symbol) string {
	return fmt.Sprintf("%s|%s:%s", strategyID, sym.Exchange, sym.Token)
}
