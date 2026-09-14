package domain

// Symbol identifies a tradable instrument on an exchange.
// It is broker-agnostic: exchange and token are the canonical identity.
type Symbol struct {
	// Exchange is the venue code (e.g. "MCX", "NSE").
	Exchange string

	// Token is the broker/exchange instrument identifier (e.g. "26000" for SILVERM).
	Token string

	// Name is a human-readable symbol name (e.g. "SILVERM").
	Name string

	// TickSize is the minimum price increment for the instrument.
	TickSize float64

	// LotSize is the minimum tradable quantity in exchange units.
	LotSize int
}
