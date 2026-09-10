package identity

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateGeneratesAndPersists(t *testing.T) {
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
