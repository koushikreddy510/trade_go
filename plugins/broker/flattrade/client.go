package flattrade

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://piconnect.flattrade.in/PiConnectAPI"
	DefaultAuthURL = "https://authapi.flattrade.in/trade/apitoken"
)

// ErrNotConfigured is returned when a PiConnect call is made without a session token.
var ErrNotConfigured = errors.New("flattrade: session token (jKey) not configured")

// Config holds Flattrade client settings.
type Config struct {
	BaseURL      string
	AuthURL      string
	APIKey       string
	APISecret    string // raw secret from Wall (not the SHA-256 hash)
	UserID       string // uid for jData
	SessionToken string // jKey
	HTTPClient   *http.Client
}

// Client is a stub Flattrade Pi API v2 HTTP client for Atlas market data.
type Client struct {
	baseURL      string
	authURL      string
	apiKey       string
	apiSecret    string
	userID       string
	sessionToken string
	httpClient   *http.Client
}

// NewClient returns a Client with defaults applied.
func NewClient(cfg Config) *Client {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	authURL := cfg.AuthURL
	if authURL == "" {
		authURL = DefaultAuthURL
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		baseURL:      baseURL,
		authURL:      authURL,
		apiKey:       cfg.APIKey,
		apiSecret:    cfg.APISecret,
		userID:       cfg.UserID,
		sessionToken: cfg.SessionToken,
		httpClient:   hc,
	}
}

// SetSessionToken updates jKey after ExchangeToken.
func (c *Client) SetSessionToken(token string) {
	c.sessionToken = token
}

// SessionToken returns the current jKey.
func (c *Client) SessionToken() string {
	return c.sessionToken
}

// EncodePiConnectForm builds application/x-www-form-urlencoded body: jData={...}&jKey=...
func EncodePiConnectForm(jData []byte, jKey string) string {
	return "jData=" + url.QueryEscape(string(jData)) + "&jKey=" + url.QueryEscape(jKey)
}

// NewPiConnectRequest shapes an http.Request for PiConnect endpoints.
func NewPiConnectRequest(ctx context.Context, baseURL, path string, payload jDataPayload, jKey string) (*http.Request, error) {
	jData, err := payload.marshalJData()
	if err != nil {
		return nil, fmt.Errorf("flattrade: marshal jData: %w", err)
	}
	body := EncodePiConnectForm(jData, jKey)
	endpoint := strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(path, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("flattrade: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return req, nil
}

// ExchangeToken exchanges a browser request_code for jKey.
// apiSecret in the request body is SHA256(apiKey+requestCode+rawAPISecret).
func (c *Client) ExchangeToken(ctx context.Context, requestCode string) (*ExchangeTokenResponse, error) {
	if c.apiKey == "" || c.apiSecret == "" {
		return nil, errors.New("flattrade: api_key and api_secret required for token exchange")
	}
	if requestCode == "" {
		return nil, errors.New("flattrade: request_code required")
	}

	reqBody := ExchangeTokenRequest{
		APIKey:      c.apiKey,
		RequestCode: requestCode,
		APISecret:   HashAPISecret(c.apiKey, requestCode, c.apiSecret),
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("flattrade: marshal token request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.authURL, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("flattrade: new token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("flattrade: token exchange: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("flattrade: read token response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("flattrade: token exchange HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var out ExchangeTokenResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("flattrade: decode token response: %w", err)
	}
	if !strings.EqualFold(out.Status, "Ok") {
		return nil, fmt.Errorf("flattrade: token exchange failed: %s", out.EMsg)
	}
	if out.Token != "" {
		c.sessionToken = out.Token
	}
	return &out, nil
}

// TPSeries fetches intraday candles. Requires a configured session token.
func (c *Client) TPSeries(ctx context.Context, req TPSeriesRequest) ([]Candle, error) {
	if c.sessionToken == "" {
		return nil, ErrNotConfigured
	}
	if req.UID == "" {
		req.UID = c.userID
	}

	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "TPSeries", req, c.sessionToken)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flattrade: TPSeries: %w", err)
	}
	defer resp.Body.Close()

	return decodeTPSeriesResponse(resp.Body)
}

// SearchScrip finds instruments by partial symbol text.
func (c *Client) SearchScrip(ctx context.Context, req SearchScripRequest) (*SearchScripResponse, error) {
	if c.sessionToken == "" {
		return nil, ErrNotConfigured
	}
	if req.UID == "" {
		req.UID = c.userID
	}

	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "SearchScrip", req, c.sessionToken)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flattrade: SearchScrip: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("flattrade: read SearchScrip response: %w", err)
	}

	var out SearchScripResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("flattrade: decode SearchScrip response: %w", err)
	}
	if strings.EqualFold(out.Stat, "Not_Ok") {
		return nil, &APIError{Stat: out.Stat, EMsg: out.EMsg}
	}
	return &out, nil
}

// GetQuotes returns a live quote snapshot for one token.
func (c *Client) GetQuotes(ctx context.Context, req GetQuotesRequest) (*Quote, error) {
	if c.sessionToken == "" {
		return nil, ErrNotConfigured
	}
	if req.UID == "" {
		req.UID = c.userID
	}

	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "GetQuotes", req, c.sessionToken)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("flattrade: GetQuotes: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("flattrade: read GetQuotes response: %w", err)
	}

	var out Quote
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("flattrade: decode GetQuotes response: %w", err)
	}
	if strings.EqualFold(out.Stat, "Not_Ok") {
		return nil, &APIError{Stat: out.Stat, EMsg: out.EMsg}
	}
	return &out, nil
}

// UserDetails validates the current session token (lightweight probe).
func (c *Client) UserDetails(ctx context.Context) error {
	if c.sessionToken == "" {
		return ErrNotConfigured
	}
	req := UserDetailsRequest{UID: c.userID}
	httpReq, err := NewPiConnectRequest(ctx, c.baseURL, "UserDetails", req, c.sessionToken)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("flattrade: UserDetails: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("flattrade: read UserDetails response: %w", err)
	}
	var out UserDetailsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return fmt.Errorf("flattrade: decode UserDetails response: %w", err)
	}
	if strings.EqualFold(out.Stat, "Not_Ok") {
		return &APIError{Stat: out.Stat, EMsg: out.EMsg}
	}
	if !strings.EqualFold(out.Stat, "Ok") && out.EMsg != "" {
		return &APIError{Stat: out.Stat, EMsg: out.EMsg}
	}
	return nil
}

// decodeTPSeriesResponse parses TPSeries JSON (array of candle objects or error object).
func decodeTPSeriesResponse(r io.Reader) ([]Candle, error) {
	body, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("flattrade: read TPSeries response: %w", err)
	}

	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return nil, errors.New("flattrade: empty TPSeries response")
	}

	if trimmed[0] == '{' {
		var apiErr APIError
		if err := json.Unmarshal(body, &apiErr); err != nil {
			return nil, fmt.Errorf("flattrade: decode TPSeries error: %w", err)
		}
		return nil, &apiErr
	}

	var candles []Candle
	if err := json.Unmarshal(body, &candles); err != nil {
		return nil, fmt.Errorf("flattrade: decode TPSeries candles: %w", err)
	}
	return candles, nil
}
