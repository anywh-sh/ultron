// Package identity is the device's Ed25519 keypair (journal/49 D7). File
// storage for now, mode 0600 — same interim shape as
// anywh-control-plane/edge/internal/identity, replicated rather than
// imported (independent Go module, journal/62 CT-2). Real OS keychain is
// F5, a storage swap, not a protocol change.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
)

// LoadOrCreate reads the private key at path, generating and persisting a
// new one if it doesn't exist yet.
func LoadOrCreate(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err == nil {
		if len(raw) != ed25519.PrivateKeySize {
			return nil, fmt.Errorf("identity file %s has unexpected size %d (want %d)", path, len(raw), ed25519.PrivateKeySize)
		}
		return ed25519.PrivateKey(raw), nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read identity file: %w", err)
	}

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate identity: %w", err)
	}
	if err := os.WriteFile(path, priv, 0o600); err != nil {
		return nil, fmt.Errorf("write identity file: %w", err)
	}
	return priv, nil
}

// PublicKeyBase64 is the raw 32-byte Ed25519 public key, standard base64 —
// the format POST /v1/nodes and POST /v1/nodes/claim expect.
func PublicKeyBase64(priv ed25519.PrivateKey) string {
	pub := priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}
