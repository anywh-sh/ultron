package identity

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/godbus/dbus/v5"
	"github.com/zalando/go-keyring"
)

// Every test below drives the keychain through zalando/go-keyring's own
// mock provider (MockInit/MockInitWithError) rather than the real OS
// backend — this package's tests must never depend on (or write into) a
// real Secret Service/Keychain/Credential Manager, and must behave the
// same whether or not this machine happens to have one. The real backend
// was confirmed live on a real machine separately — not something
// re-proven here on every `go test`.

func TestLoadOrCreateUsesKeychainWhenAvailable(t *testing.T) {
	keyring.MockInit()
	path := filepath.Join(t.TempDir(), "identity.key")

	priv, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected no fallback file to be created when the keychain is available, stat err = %v", err)
	}

	reloaded, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate (reload): %v", err)
	}
	if !priv.Equal(reloaded) {
		t.Fatal("expected reloading from the keychain to return the same key, got a different one")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("reload created a fallback file even though the keychain already held the identity, stat err = %v", err)
	}
}

func TestLoadOrCreateFallsBackToFileWhenThereIsNoKeychainBackend(t *testing.T) {
	keyring.MockInitWithError(dbus.Error{Name: "org.freedesktop.DBus.Error.ServiceUnknown"})
	path := filepath.Join(t.TempDir(), "identity.key")

	priv, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat identity file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("identity file mode = %o, want 0600", perm)
	}

	reloaded, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate (reload): %v", err)
	}
	if !priv.Equal(reloaded) {
		t.Fatal("expected reloading an existing identity file to return the same key, got a different one")
	}
}

func TestLoadOrCreatePropagatesARealKeychainError(t *testing.T) {
	// Not one of the two "no backend at all" shapes isNoKeychainBackend
	// recognizes — a locked keyring, a permission error, anything else —
	// must fail loudly instead of silently generating a second identity
	// in a file, which would orphan whatever the keychain already holds.
	keyring.MockInitWithError(errors.New("keyring is locked"))
	path := filepath.Join(t.TempDir(), "identity.key")

	if _, err := LoadOrCreate(path); err == nil {
		t.Fatal("expected a real keychain error to propagate, got nil")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected no fallback file on a real keychain error, stat err = %v", err)
	}
}

func TestLoadOrCreatePrefersAnExistingFileOverTheKeychain(t *testing.T) {
	// An identity already on disk (an older install, or a
	// device that already fell back once) is never migrated into the
	// keychain automatically.
	keyring.MockInit()
	path := filepath.Join(t.TempDir(), "identity.key")
	fileKey, err := loadOrCreateFile(path)
	if err != nil {
		t.Fatalf("seed file identity: %v", err)
	}

	got, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	if !fileKey.Equal(got) {
		t.Fatal("expected the pre-existing file identity to win over the keychain, got a different key")
	}
	if _, err := keyring.Get(keyringService, keyringUser); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("expected the keychain to stay untouched, got err = %v", err)
	}
}

func TestLoadOrCreateRejectsWrongSizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.key")
	if err := os.WriteFile(path, []byte("not a key"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	if _, err := LoadOrCreate(path); err == nil {
		t.Fatal("expected an error for a file that isn't a valid Ed25519 private key")
	}
}

func TestPublicKeyBase64Length(t *testing.T) {
	keyring.MockInit()
	priv, err := LoadOrCreate(filepath.Join(t.TempDir(), "identity.key"))
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}

	// Raw 32-byte Ed25519 public key, standard base64 (no padding stripped) —
	// the shape POST /v1/nodes and POST /v1/nodes/claim expect.
	if got := len(PublicKeyBase64(priv)); got != 44 {
		t.Fatalf("public key base64 length = %d, want 44", got)
	}
}

func TestIsNoKeychainBackend(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"dbus ServiceUnknown — no Secret Service registered", dbus.Error{Name: "org.freedesktop.DBus.Error.ServiceUnknown"}, true},
		{"dial failure — no session bus at all (headless Linux)", &net.OpError{Op: "dial", Err: errors.New("no such file or directory")}, true},
		{"some other dbus error", dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied"}, false},
		{"unrelated error", errors.New("keyring is locked"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNoKeychainBackend(tc.err); got != tc.want {
				t.Fatalf("isNoKeychainBackend(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}
