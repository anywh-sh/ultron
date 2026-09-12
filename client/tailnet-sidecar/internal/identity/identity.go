// Package identity is the device's Ed25519 keypair. Prefers the OS keychain
// (github.com/zalando/go-keyring — macOS Keychain, Windows Credential
// Manager, Linux Secret Service), same four-platform behavior already
// researched for the Rust crate this project ended up not using once
// identity moved into this Go binary instead. Falls back to a file, mode
// 0600 — the same shape the control plane's own Node implementation uses
// (replicated rather than imported, independent Go module) — for
// headless Linux, where there's no Secret Service to speak of at
// all (no D-Bus session, no gnome-keyring/KWallet).
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"os"

	"github.com/godbus/dbus/v5"
	"github.com/zalando/go-keyring"
)

const (
	keyringService = "anywh-tailnet-identity"
	keyringUser    = "device"
)

// LoadOrCreate reads the device's private key, generating and persisting a
// new one if none exists yet. An identity already sitting at `path` (a
// pre-F5 install, or a device that already fell back to the file once)
// always wins — this never silently migrates an existing file-based
// identity into the keychain, which would risk the account's control-plane
// registration and this device's local identity pointing at two different
// keys if anything about the move went wrong.
func LoadOrCreate(path string) (ed25519.PrivateKey, error) {
	if _, err := os.Stat(path); err == nil {
		return loadOrCreateFile(path)
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("stat identity file: %w", err)
	}

	priv, err := loadOrCreateKeychain()
	if err == nil {
		return priv, nil
	}
	if !isNoKeychainBackend(err) {
		// A keychain error that isn't "there's genuinely no backend here"
		// is a real problem, not a signal to fall back — silently
		// generating a second identity in a file on what might just be a
		// transient failure would orphan whatever's already registered
		// server-side under the keychain-held key.
		return nil, fmt.Errorf("keychain identity: %w", err)
	}
	return loadOrCreateFile(path)
}

// isNoKeychainBackend recognizes the two shapes a real, empty run of this
// machine actually produces when there's no Secret Service to talk to
// (confirmed live against this project's own dev box, which has a live
// D-Bus session but no gnome-keyring/KWallet installed):
// `org.freedesktop.DBus.Error.ServiceUnknown` when a session bus exists but
// nothing registered the secrets service, and a plain dial failure
// (*net.OpError) when there's no session bus to connect to at all —
// the literal headless-Linux case. Any other error (locked
// keyring, permission denied, a malformed secret) is treated as real.
func isNoKeychainBackend(err error) bool {
	var dbusErr dbus.Error
	if errors.As(err, &dbusErr) {
		return dbusErr.Name == "org.freedesktop.DBus.Error.ServiceUnknown"
	}
	var opErr *net.OpError
	return errors.As(err, &opErr)
}

func loadOrCreateFile(path string) (ed25519.PrivateKey, error) {
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

func loadOrCreateKeychain() (ed25519.PrivateKey, error) {
	encoded, err := keyring.Get(keyringService, keyringUser)
	if err == nil {
		raw, decodeErr := base64.StdEncoding.DecodeString(encoded)
		if decodeErr != nil {
			return nil, fmt.Errorf("decode keychain identity: %w", decodeErr)
		}
		if len(raw) != ed25519.PrivateKeySize {
			return nil, fmt.Errorf("keychain identity has unexpected size %d (want %d)", len(raw), ed25519.PrivateKeySize)
		}
		return ed25519.PrivateKey(raw), nil
	}
	if !errors.Is(err, keyring.ErrNotFound) {
		return nil, err
	}

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate identity: %w", err)
	}
	if err := keyring.Set(keyringService, keyringUser, base64.StdEncoding.EncodeToString(priv)); err != nil {
		return nil, err
	}
	return priv, nil
}

// PublicKeyBase64 is the raw 32-byte Ed25519 public key, standard base64 —
// the format POST /v1/nodes and POST /v1/nodes/claim expect.
func PublicKeyBase64(priv ed25519.PrivateKey) string {
	pub := priv.Public().(ed25519.PublicKey)
	return base64.StdEncoding.EncodeToString(pub)
}
