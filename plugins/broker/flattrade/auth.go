package flattrade

import (
	"crypto/sha256"
	"encoding/hex"
)

// HashAPISecret returns the SHA-256 hex digest Flattrade expects for token exchange:
//
//	SHA256(apiKey + requestCode + rawAPISecret)
//
// See https://pi.flattrade.in/docs (Login Flow).
func HashAPISecret(apiKey, requestCode, rawAPISecret string) string {
	sum := sha256.Sum256([]byte(apiKey + requestCode + rawAPISecret))
	return hex.EncodeToString(sum[:])
}
