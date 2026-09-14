package flattrade_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
)

func TestHashAPISecret(t *testing.T) {
	t.Parallel()

	got := flattrade.HashAPISecret("api_key", "request_code", "raw_secret")
	if len(got) != 64 {
		t.Fatalf("expected 64-char hex digest, got len %d", len(got))
	}
	for _, c := range got {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			t.Fatalf("expected lowercase hex, got %q", got)
		}
	}

	// Deterministic for same inputs.
	got2 := flattrade.HashAPISecret("api_key", "request_code", "raw_secret")
	if got != got2 {
		t.Fatalf("hash not deterministic: %q vs %q", got, got2)
	}
}

func TestEncodePiConnectForm(t *testing.T) {
	t.Parallel()

	jData := []byte(`{"uid":"FT0001","exch":"MCX","token":"123"}`)
	body := flattrade.EncodePiConnectForm(jData, "jkey-token")

	if !strings.HasPrefix(body, "jData=") {
		t.Fatalf("body should start with jData=: %q", body)
	}
	if !strings.Contains(body, "&jKey=") {
		t.Fatalf("body should contain &jKey=: %q", body)
	}
	if strings.Contains(body, " ") {
		t.Fatalf("form body should not contain spaces: %q", body)
	}
}

func TestNewPiConnectRequest(t *testing.T) {
	t.Parallel()

	req, err := flattrade.NewPiConnectRequest(
		context.Background(),
		"https://piconnect.flattrade.in/PiConnectAPI",
		"GetQuotes",
		flattrade.GetQuotesRequest{UID: "FT0001", Exch: "MCX", Token: "99"},
		"test-jkey",
	)
	if err != nil {
		t.Fatalf("NewPiConnectRequest: %v", err)
	}

	if req.Method != http.MethodPost {
		t.Fatalf("method = %q, want POST", req.Method)
	}
	if ct := req.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
		t.Fatalf("content-type = %q", ct)
	}
	if req.URL.String() != "https://piconnect.flattrade.in/PiConnectAPI/GetQuotes" {
		t.Fatalf("url = %q", req.URL.String())
	}

	raw, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	body := string(raw)
	if !strings.Contains(body, "jData=") || !strings.Contains(body, "jKey=test-jkey") {
		t.Fatalf("unexpected body: %q", body)
	}
}

func TestClientTPSeriesRequiresToken(t *testing.T) {
	t.Parallel()

	c := flattrade.NewClient(flattrade.Config{UserID: "FT0001"})
	_, err := c.TPSeries(context.Background(), flattrade.TPSeriesRequest{
		Exch:  "MCX",
		Token: "1",
		Intrv: flattrade.Interval1H,
	})
	if err != flattrade.ErrNotConfigured {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestExchangeToken(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %q", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); !strings.Contains(ct, "application/json") {
			t.Fatalf("content-type = %q", ct)
		}

		var req flattrade.ExchangeTokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if req.APIKey != "key" || req.RequestCode != "code" {
			t.Fatalf("unexpected request: %+v", req)
		}
		expected := flattrade.HashAPISecret("key", "code", "secret")
		if req.APISecret != expected {
			t.Fatalf("api_secret hash mismatch")
		}

		_ = json.NewEncoder(w).Encode(flattrade.ExchangeTokenResponse{
			Token:  "session-token",
			Client: "FT0001",
			Status: "Ok",
		})
	}))
	defer srv.Close()

	c := flattrade.NewClient(flattrade.Config{
		AuthURL:    srv.URL,
		APIKey:     "key",
		APISecret:  "secret",
		HTTPClient: srv.Client(),
	})

	resp, err := c.ExchangeToken(context.Background(), "code")
	if err != nil {
		t.Fatalf("ExchangeToken: %v", err)
	}
	if resp.Token != "session-token" {
		t.Fatalf("token = %q", resp.Token)
	}
	if c.SessionToken() != "session-token" {
		t.Fatalf("client session token not set")
	}
}

func TestAtlasInterval(t *testing.T) {
	t.Parallel()

	cases := []struct {
		tf   string
		want flattrade.Interval
		ok   bool
	}{
		{"1H", flattrade.Interval1H, true},
		{"2h", flattrade.Interval2H, true},
		{"4H", "", false},
		{"15m", "", false},
	}
	for _, tc := range cases {
		got, ok := flattrade.AtlasInterval(tc.tf)
		if ok != tc.ok || got != tc.want {
			t.Fatalf("AtlasInterval(%q) = (%q, %v), want (%q, %v)", tc.tf, got, ok, tc.want, tc.ok)
		}
	}
}
