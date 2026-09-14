package flattrade

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/repository"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
)

const browserAuthURL = "https://auth.flattrade.in/?app_key="

// BrowserAuthURL returns the Flattrade browser OAuth URL for the given API key.
func BrowserAuthURL(apiKey string) string {
	return browserAuthURL + apiKey
}

// SessionManager loads and persists the daily Flattrade jKey session token.
type SessionManager struct {
	client *Client
	store  repository.TokenStore
	log    *logging.Logger
	token  string
}

// NewSessionManager returns a SessionManager for the given client and token store.
func NewSessionManager(client *Client, store repository.TokenStore, log *logging.Logger) *SessionManager {
	if log == nil {
		log = logging.New("flattrade.session")
	}
	return &SessionManager{
		client: client,
		store:  store,
		log:    log,
	}
}

// Client returns the underlying Flattrade API client.
func (m *SessionManager) Client() *Client {
	return m.client
}

// Token returns the current in-memory jKey, if loaded or exchanged.
func (m *SessionManager) Token() string {
	if m.token != "" {
		return m.token
	}
	return m.client.SessionToken()
}

// Load loads jKey from the token store into the client.
func (m *SessionManager) Load(ctx context.Context) error {
	token, err := m.store.Get(ctx, repository.FlattradeTokenKey())
	if err != nil {
		if errors.Is(err, repository.ErrTokenNotFound) {
			return repository.ErrTokenNotFound
		}
		return fmt.Errorf("flattrade session: load: %w", err)
	}
	m.client.SetSessionToken(token)
	m.token = token
	return nil
}

// ExchangeAndStore exchanges request_code for jKey, sets it on the client, and stores it in Redis.
func (m *SessionManager) ExchangeAndStore(ctx context.Context, requestCode string) (string, error) {
	resp, err := m.client.ExchangeToken(ctx, requestCode)
	if err != nil {
		return "", fmt.Errorf("flattrade session: exchange: %w", err)
	}

	token := resp.Token
	if token == "" {
		token = m.client.SessionToken()
	}
	if token == "" {
		return "", errors.New("flattrade session: empty token in exchange response")
	}

	m.client.SetSessionToken(token)
	m.token = token

	ttl := DefaultTokenTTL(time.Now())
	if err := m.store.Set(ctx, repository.FlattradeTokenKey(), token, ttl); err != nil {
		return "", fmt.Errorf("flattrade session: store: %w", err)
	}

	m.log.Info("flattrade session token stored", "ttl_hours", ttl.Hours())
	return token, nil
}

// EnsureValid loads the token from Redis (if needed) and validates it with a lightweight API call.
// Returns nil when the session is usable for the trading day.
func (m *SessionManager) EnsureValid(ctx context.Context) error {
	if m.Token() == "" {
		if err := m.Load(ctx); err != nil {
			return err
		}
	}
	return m.Validate(ctx)
}

// Validate probes the broker API with the current jKey (UserDetails).
func (m *SessionManager) Validate(ctx context.Context) error {
	if m.client.SessionToken() == "" {
		return ErrNotConfigured
	}
	if err := m.client.UserDetails(ctx); err != nil {
		return fmt.Errorf("flattrade session: validate: %w", err)
	}
	return nil
}

// DefaultTokenTTL returns the Redis TTL until the next 5:30 AM IST session reset.
func DefaultTokenTTL(now time.Time) time.Duration {
	ist := now.In(scheduler.IST)
	expire := time.Date(ist.Year(), ist.Month(), ist.Day(), 5, 30, 0, 0, scheduler.IST)
	if !now.Before(expire) {
		expire = expire.Add(24 * time.Hour)
	}
	return expire.Sub(now)
}
