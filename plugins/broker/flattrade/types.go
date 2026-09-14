package flattrade

import "encoding/json"

// Interval is a Flattrade TPSeries intrv value in minutes.
type Interval string

const (
	Interval1m   Interval = "1"
	Interval3m   Interval = "3"
	Interval5m   Interval = "5"
	Interval10m  Interval = "10"
	Interval15m  Interval = "15"
	Interval30m  Interval = "30"
	Interval1H   Interval = "60"
	Interval2H   Interval = "120"
)

// AtlasInterval maps Atlas timeframe names to Flattrade intervals.
// 4H is not native; callers must aggregate from Interval1H bars.
func AtlasInterval(tf string) (Interval, bool) {
	switch tf {
	case "1H", "1h":
		return Interval1H, true
	case "2H", "2h":
		return Interval2H, true
	case "4H", "4h":
		return "", false
	default:
		return "", false
	}
}

// ExchangeTokenRequest is the JSON body for POST /trade/apitoken.
type ExchangeTokenRequest struct {
	APIKey      string `json:"api_key"`
	RequestCode string `json:"request_code"`
	APISecret   string `json:"api_secret"` // SHA-256 hex of api_key+request_code+raw secret
}

// ExchangeTokenResponse is returned on successful token exchange.
type ExchangeTokenResponse struct {
	Token  string `json:"token"`
	Client string `json:"client"`
	Status string `json:"status"`
	EMsg   string `json:"emsg"`
}

// TPSeriesRequest is the jData payload for POST /TPSeries.
type TPSeriesRequest struct {
	UID   string   `json:"uid"`
	Exch  string   `json:"exch"`
	Token string   `json:"token"`
	Start string   `json:"st,omitempty"`   // Unix seconds
	End   string   `json:"et,omitempty"`   // Unix seconds
	Intrv Interval `json:"intrv,omitempty"`
}

// Candle is one TPSeries bar.
type Candle struct {
	Stat string `json:"stat"`
	Time string `json:"time"`
	Into string `json:"into"`
	Inth string `json:"inth"`
	Intl string `json:"intl"`
	Intc string `json:"intc"`
	Intv string `json:"intv"`
	V    string `json:"v"`
	OI   string `json:"oi"`
}

// APIError is a standard Flattrade Not_Ok response.
type APIError struct {
	Stat string `json:"stat"`
	EMsg string `json:"emsg"`
}

func (e *APIError) Error() string {
	if e == nil {
		return "flattrade: unknown error"
	}
	if e.EMsg != "" {
		return e.EMsg
	}
	return e.Stat
}

// SearchScripRequest is the jData payload for POST /SearchScrip.
type SearchScripRequest struct {
	UID    string `json:"uid"`
	SText  string `json:"stext"`
	Exch   string `json:"exch,omitempty"`
}

// ScripMatch is one entry in SearchScrip values.
type ScripMatch struct {
	Exch     string `json:"exch"`
	Tsym     string `json:"tsym"`
	Token    string `json:"token"`
	PP       string `json:"pp"`
	TI       string `json:"ti"`
	LS       string `json:"ls"`
	InstName string `json:"instname"` // e.g. FUTCOM
}

// SearchScripResponse is the SearchScrip API response.
type SearchScripResponse struct {
	Stat   string       `json:"stat"`
	Values []ScripMatch `json:"values"`
	EMsg   string       `json:"emsg"`
}

// GetQuotesRequest is the jData payload for POST /GetQuotes.
type GetQuotesRequest struct {
	UID   string `json:"uid"`
	Exch  string `json:"exch"`
	Token string `json:"token"`
}

// Quote is the GetQuotes response (subset used by Atlas).
type Quote struct {
	Stat        string `json:"stat"`
	RequestTime string `json:"request_time"`
	Exch        string `json:"exch"`
	Tsym        string `json:"tsym"`
	Token       string `json:"token"`
	LP          string `json:"lp"`
	H           string `json:"h"`
	L           string `json:"l"`
	V           string `json:"v"`
	OI          string `json:"oi"`
	EMsg        string `json:"emsg"`
}

// UserDetailsRequest is the jData payload for POST /UserDetails.
type UserDetailsRequest struct {
	UID string `json:"uid"`
}

// UserDetailsResponse is a subset of POST /UserDetails used for session validation.
type UserDetailsResponse struct {
	Stat   string `json:"stat"`
	ActID  string `json:"actid"`
	EMsg   string `json:"emsg"`
}

// jDataPayload is implemented by PiConnect jData request types.
type jDataPayload interface {
	marshalJData() ([]byte, error)
}

// PlaceOrderRequest is the jData payload for POST /PlaceOrder.
type PlaceOrderRequest struct {
	UID      string `json:"uid"`
	ActID    string `json:"actid"`
	Exch     string `json:"exch"`
	Tsym     string `json:"tsym"`
	Qty      string `json:"qty"`
	Prc      string `json:"prc"`
	Prd      string `json:"prd"`
	TranType string `json:"trantype"`
	Prctyp   string `json:"prctyp"`
	Ret      string `json:"ret"`
	Trgprc   string `json:"trgprc,omitempty"`
	Remarks  string `json:"remarks,omitempty"`
}

// PlaceOrderResponse is returned by POST /PlaceOrder.
type PlaceOrderResponse struct {
	Stat        string `json:"stat"`
	RequestTime string `json:"request_time"`
	NorenOrdNo  string `json:"norenordno"`
	EMsg        string `json:"emsg"`
}

// ModifyOrderRequest is the jData payload for POST /ModifyOrder.
type ModifyOrderRequest struct {
	UID         string `json:"uid"`
	ActID       string `json:"actid"`
	Exch        string `json:"exch"`
	Tsym        string `json:"tsym"`
	Qty         string `json:"qty"`
	Prc         string `json:"prc"`
	Prctyp      string `json:"prctyp"`
	Ret         string `json:"ret"`
	NorenOrdNo  string `json:"norenordno"`
	Trgprc      string `json:"trgprc,omitempty"`
}

// ModifyOrderResponse is returned by POST /ModifyOrder.
type ModifyOrderResponse struct {
	Stat        string `json:"stat"`
	RequestTime string `json:"request_time"`
	NorenOrdNo  string `json:"norenordno"`
	EMsg        string `json:"emsg"`
}

// CancelOrderRequest is the jData payload for POST /CancelOrder.
type CancelOrderRequest struct {
	UID        string `json:"uid"`
	NorenOrdNo string `json:"norenordno"`
}

// CancelOrderResponse is returned by POST /CancelOrder.
type CancelOrderResponse struct {
	Stat        string `json:"stat"`
	RequestTime string `json:"request_time"`
	NorenOrdNo  string `json:"norenordno"`
	EMsg        string `json:"emsg"`
}

func (r TPSeriesRequest) marshalJData() ([]byte, error)     { return json.Marshal(r) }
func (r SearchScripRequest) marshalJData() ([]byte, error) { return json.Marshal(r) }
func (r GetQuotesRequest) marshalJData() ([]byte, error)     { return json.Marshal(r) }
func (r UserDetailsRequest) marshalJData() ([]byte, error)   { return json.Marshal(r) }
func (r PlaceOrderRequest) marshalJData() ([]byte, error)    { return json.Marshal(r) }
func (r ModifyOrderRequest) marshalJData() ([]byte, error)   { return json.Marshal(r) }
func (r CancelOrderRequest) marshalJData() ([]byte, error)   { return json.Marshal(r) }
