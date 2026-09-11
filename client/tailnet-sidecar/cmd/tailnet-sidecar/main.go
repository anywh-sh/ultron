// tailnet-sidecar (journal/62): the Go binary the Tauri client spawns as a
// sidecar to join a Tailscale/Headscale tailnet and sign requests, without
// ever knowing the anywh-control-plane API's own shape (journal/62 CT-1 —
// that boundary is the whole reason this binary exists at all). Three
// subcommands: "identity" (F1), "sign" (F1), "tailnet-up" (the spike, F1
// packages it the same way).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	"github.com/anywh-sh/anywh/client/tailnet-sidecar/internal/identity"
	"github.com/anywh-sh/anywh/client/tailnet-sidecar/internal/signature"
	"github.com/anywh-sh/anywh/client/tailnet-sidecar/internal/tailnetup"
	"tailscale.com/tsnet"
)

func usage() {
	fmt.Fprintln(os.Stderr, `usage:
  tailnet-sidecar identity -path=<file>
  tailnet-sidecar sign -identity=<file> -method=<M> -path=<P> [-body=<B>] [-ts=<unix-ms>]
  tailnet-sidecar tailnet-up -auth-key=... -control-url=... -target=host:port [-listen=127.0.0.1:0] [-hostname=...] [-state-dir=...]`)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "identity":
		runIdentity(os.Args[2:])
	case "sign":
		runSign(os.Args[2:])
	case "tailnet-up":
		runTailnetUp(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

// runIdentity loads (or creates) the device's Ed25519 keypair and prints
// its public key — the same base64 shape POST /v1/nodes and
// POST /v1/nodes/claim expect. Never prints the private key; it never
// leaves the identity file (journal/49 D7).
func runIdentity(args []string) {
	fs := flag.NewFlagSet("identity", flag.ExitOnError)
	path := fs.String("path", "", "identity file (required)")
	if err := fs.Parse(args); err != nil {
		log.Fatalf("parse flags: %v", err)
	}
	if *path == "" {
		fmt.Fprintln(os.Stderr, "path is required")
		os.Exit(2)
	}

	priv, err := identity.LoadOrCreate(*path)
	if err != nil {
		log.Fatalf("identity: %v", err)
	}
	fmt.Println(identity.PublicKeyBase64(priv))
}

type signResult struct {
	Ts  int64  `json:"ts"`
	Sig string `json:"sig"`
}

// runSign signs an HTTP request's method/path/body with the device
// identity, in the exact format anywh-control-plane's
// src/auth/nodeSignature.ts (verifyNodeSignature) expects. It never learns
// the header names or the meaning of the path it's signing — that's on the
// caller (journal/62 CT-1): this command only knows Ed25519, not the
// control plane's API.
func runSign(args []string) {
	fs := flag.NewFlagSet("sign", flag.ExitOnError)
	identityPath := fs.String("identity", "", "identity file (required)")
	method := fs.String("method", "", "HTTP method (required)")
	reqPath := fs.String("path", "", "HTTP request path (required)")
	body := fs.String("body", "", "request body")
	ts := fs.Int64("ts", 0, "unix ms timestamp override (defaults to now)")
	if err := fs.Parse(args); err != nil {
		log.Fatalf("parse flags: %v", err)
	}
	if *identityPath == "" || *method == "" || *reqPath == "" {
		fmt.Fprintln(os.Stderr, "identity, method and path are all required")
		os.Exit(2)
	}

	priv, err := identity.LoadOrCreate(*identityPath)
	if err != nil {
		log.Fatalf("identity: %v", err)
	}

	timestampMs := *ts
	if timestampMs == 0 {
		timestampMs = time.Now().UnixMilli()
	}

	sig := signature.Sign(priv, *method, *reqPath, timestampMs, []byte(*body))
	out, err := json.Marshal(signResult{Ts: timestampMs, Sig: sig})
	if err != nil {
		log.Fatalf("marshal result: %v", err)
	}
	fmt.Println(string(out))
}

func runTailnetUp(args []string) {
	fs := flag.NewFlagSet("tailnet-up", flag.ExitOnError)
	authKey := fs.String("auth-key", "", "tsnet pre-auth key (required)")
	controlURL := fs.String("control-url", "", "Headscale control URL (required)")
	target := fs.String("target", "", "host:port to dial inside the tailnet (required)")
	listen := fs.String("listen", "127.0.0.1:0", "local address to listen on")
	hostname := fs.String("hostname", "", "tsnet hostname (required)")
	stateDir := fs.String("state-dir", "", "where this node keeps its identity (required)")
	if err := fs.Parse(args); err != nil {
		log.Fatalf("parse flags: %v", err)
	}
	if *authKey == "" || *controlURL == "" || *target == "" {
		fmt.Fprintln(os.Stderr, "auth-key, control-url and target are all required")
		os.Exit(2)
	}

	srv, err := newTsnetServer(tsnetConfig{
		hostname:   *hostname,
		controlURL: *controlURL,
		authKey:    *authKey,
		stateDir:   *stateDir,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	defer srv.Close()

	status, err := srv.Up(context.Background())
	if err != nil {
		log.Fatalf("tsnet up: %v", err)
	}
	log.Printf("tsnet up, joined %s", *controlURL)
	if status.Self != nil {
		// Rust reads this to report the node key Headscale just assigned
		// back to whatever minted this profile's auth key (anywh-control-plane's
		// POST /v1/nodes/{id}/tailnet, journal/62 CT-1 follow-up) — this
		// binary never learns why it matters, only that Rust wants it. A
		// public key, not a secret: same value GET /api/v1/node already
		// hands back to any caller, and what edge/internal/proxy's
		// ReportTailnetKey already sends in production for the sandbox side.
		fmt.Printf("NODE_KEY %s\n", status.Self.PublicKey.String())
	}

	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("local listen on %s: %v", *listen, err)
	}
	// Rust reads this line to know which port the OS picked (listen=...:0).
	fmt.Printf("LISTENING %s\n", ln.Addr().String())
	log.Printf("local listener up on %s, forwarding to %s inside the tailnet", ln.Addr(), *target)

	tnSrv := &tailnetup.Server{
		Target: *target,
		Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
			start := time.Now()
			conn, err := srv.Dial(ctx, network, addr)
			if err != nil {
				log.Printf("dial %s inside tailnet: %v (after %s)", addr, err, time.Since(start))
				return nil, err
			}
			log.Printf("dial %s inside tailnet: connected after %s", addr, time.Since(start))
			return conn, nil
		},
	}
	log.Fatal(tnSrv.Serve(ln))
}

// tsnetConfig is everything the sidecar's tailnet node is built from. It
// stays a plain struct so the decisions below can be asserted in a test
// without a real tailnet.
type tsnetConfig struct {
	hostname   string
	controlURL string
	authKey    string
	stateDir   string
}

// newTsnetServer builds the tsnet node this sidecar runs as. Two of these
// fields are load-bearing, and both were wrong for as long as the spike's
// configuration survived into F2:
//
// Ephemeral must be false. An ephemeral node is deleted from the tailnet the
// moment it disconnects, so every start has to register again — and
// registering needs a pre-auth key, which the control plane mints single-use
// with a 15-minute TTL and considers spent on first use (journal/50 3.1). A
// profile paired an hour ago has no usable key left, so an ephemeral node
// could join exactly once and was permanently unable to come back
// afterwards: "backend: authkey expired", which is precisely what a paired
// Windows client reported on every start after its first.
//
// Dir is where the node identity earned by that single registration is kept,
// so it has to be a stable per-profile path. Empty makes tsnet fall back to
// a path derived from the hostname alone, shared by every profile on the
// machine — two profiles would then fight over one identity. Refused rather
// than defaulted: a silent fallback is the failure this exists to prevent.
func newTsnetServer(cfg tsnetConfig) (*tsnet.Server, error) {
	if cfg.stateDir == "" {
		return nil, errors.New("state-dir is required: without it the node identity does not survive a restart")
	}
	if cfg.hostname == "" {
		return nil, errors.New("hostname is required")
	}
	return &tsnet.Server{
		Hostname:   cfg.hostname,
		ControlURL: cfg.controlURL,
		AuthKey:    cfg.authKey,
		Dir:        cfg.stateDir,
		Ephemeral:  false,
	}, nil
}
