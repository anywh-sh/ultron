// Spike for journal/62 (anywh workspace) — proves tsnet-based tailnet
// join works standalone, before any Tauri integration. Only the
// "tailnet-up" mode exists here; "identity" and "sign" are F1, not this
// spike.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"time"

	"tailscale.com/tsnet"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "tailnet-up" {
		fmt.Fprintln(os.Stderr, "usage: tailnet-sidecar tailnet-up -auth-key=... -control-url=... -target=host:port [-listen=127.0.0.1:0] [-hostname=...] [-state-dir=...]")
		os.Exit(2)
	}

	fs := flag.NewFlagSet("tailnet-up", flag.ExitOnError)
	authKey := fs.String("auth-key", "", "tsnet pre-auth key (required)")
	controlURL := fs.String("control-url", "", "Headscale control URL (required)")
	target := fs.String("target", "", "host:port to dial inside the tailnet (required)")
	listen := fs.String("listen", "127.0.0.1:0", "local address to listen on")
	hostname := fs.String("hostname", "tailnet-sidecar-spike", "tsnet hostname")
	stateDir := fs.String("state-dir", "", "tsnet state dir (defaults to a temp dir)")
	if err := fs.Parse(os.Args[2:]); err != nil {
		log.Fatalf("parse flags: %v", err)
	}
	if *authKey == "" || *controlURL == "" || *target == "" {
		fmt.Fprintln(os.Stderr, "auth-key, control-url and target are all required")
		os.Exit(2)
	}

	srv := &tsnet.Server{
		Hostname:   *hostname,
		ControlURL: *controlURL,
		AuthKey:    *authKey,
		Dir:        *stateDir,
		Ephemeral:  true,
	}
	defer srv.Close()

	if _, err := srv.Up(context.Background()); err != nil {
		log.Fatalf("tsnet up: %v", err)
	}
	log.Printf("tsnet up, joined %s", *controlURL)

	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("local listen on %s: %v", *listen, err)
	}
	// Rust reads this line to know which port the OS picked (listen=...:0).
	fmt.Printf("LISTENING %s\n", ln.Addr().String())
	log.Printf("local listener up on %s, forwarding to %s inside the tailnet", ln.Addr(), *target)

	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Fatalf("accept: %v", err)
		}
		go handleConn(srv, conn, *target)
	}
}

func handleConn(srv *tsnet.Server, local net.Conn, target string) {
	defer local.Close()

	start := time.Now()
	remote, err := srv.Dial(context.Background(), "tcp", target)
	if err != nil {
		log.Printf("dial %s inside tailnet: %v (after %s)", target, err, time.Since(start))
		return
	}
	log.Printf("dial %s inside tailnet: connected after %s", target, time.Since(start))
	defer remote.Close()

	done := make(chan struct{}, 2)
	go func() {
		io.Copy(remote, local)
		done <- struct{}{}
	}()
	go func() {
		io.Copy(local, remote)
		done <- struct{}{}
	}()
	<-done
}
