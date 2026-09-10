package main

import "testing"

func TestNewTsnetServerIsNotEphemeral(t *testing.T) {
	// An ephemeral node is deleted from the tailnet the moment it
	// disconnects, so every start has to register again — and registering
	// needs a pre-auth key, which the control plane mints single-use with a
	// 15-minute TTL. A profile paired an hour ago has no usable key left, so
	// an ephemeral node can join exactly once and is then permanently unable
	// to come back ("backend: authkey expired", observed live on Windows).
	srv, err := newTsnetServer(tsnetConfig{
		hostname:   "ultron-client-abc",
		controlURL: "https://headscale.test",
		authKey:    "key",
		stateDir:   t.TempDir(),
	})
	if err != nil {
		t.Fatalf("newTsnetServer: %v", err)
	}
	if srv.Ephemeral {
		t.Error("tsnet server is ephemeral: its node identity will not survive a restart")
	}
}

func TestNewTsnetServerKeepsIdentityWhereItWasToldTo(t *testing.T) {
	// The state dir is where the node identity earned by that single
	// registration lives. Falling back to tsnet's default would put every
	// profile on this machine in the same directory, fighting over one
	// identity.
	dir := t.TempDir()
	srv, err := newTsnetServer(tsnetConfig{
		hostname:   "ultron-client-abc",
		controlURL: "https://headscale.test",
		authKey:    "key",
		stateDir:   dir,
	})
	if err != nil {
		t.Fatalf("newTsnetServer: %v", err)
	}
	if srv.Dir != dir {
		t.Errorf("state dir = %q, want %q", srv.Dir, dir)
	}
	if srv.Hostname != "ultron-client-abc" {
		t.Errorf("hostname = %q, want the one it was given", srv.Hostname)
	}
}

func TestNewTsnetServerRefusesAnUnsetStateDir(t *testing.T) {
	// Rejected rather than defaulted: a silent fallback to a shared path is
	// exactly the failure this is meant to make impossible.
	if _, err := newTsnetServer(tsnetConfig{
		hostname:   "ultron-client-abc",
		controlURL: "https://headscale.test",
		authKey:    "key",
	}); err == nil {
		t.Error("expected an error for an empty state dir, got none")
	}
}
