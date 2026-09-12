// Package tailnetup is the local-listener<->tailnet splice that the
// tailnet-up subcommand performs, kept free of any tsnet import — same
// separation the control plane's own proxy uses for its
// splice logic, so the accept/dial/copy behavior here is testable with a
// plain net.Listener and net.Dial. Only cmd/tailnet-sidecar/main.go wires a
// real tsnet.Server.Dial into it.
package tailnetup

import (
	"context"
	"io"
	"log"
	"net"
	"sync"
)

// Server accepts local connections and splices each one into Target,
// dialed via Dial — the direction is the mirror image of the control
// plane's own proxy (that one accepts from
// inside the tailnet and dials out locally; this one accepts locally and
// dials into the tailnet).
type Server struct {
	Target string
	// Dial defaults to a plain net.Dial; overridable so tests can fake or
	// fail the tailnet leg without a real tailnet, and so
	// cmd/tailnet-sidecar can plug in a tsnet.Server's own Dial for the
	// real thing.
	Dial func(ctx context.Context, network, addr string) (net.Conn, error)
	Log  *log.Logger
}

func (s *Server) dial(ctx context.Context, network, addr string) (net.Conn, error) {
	if s.Dial != nil {
		return s.Dial(ctx, network, addr)
	}
	return (&net.Dialer{}).DialContext(ctx, network, addr)
}

func (s *Server) logf(format string, args ...any) {
	if s.Log != nil {
		s.Log.Printf(format, args...)
	}
}

// Serve accepts connections from ln until it's closed.
func (s *Server) Serve(ln net.Listener) error {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		go s.handleConn(conn)
	}
}

func (s *Server) handleConn(local net.Conn) {
	defer local.Close()

	remote, err := s.dial(context.Background(), "tcp", s.Target)
	if err != nil {
		s.logf("tailnetup: dial %s: %v", s.Target, err)
		return
	}
	defer remote.Close()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		io.Copy(remote, local)
	}()
	go func() {
		defer wg.Done()
		io.Copy(local, remote)
	}()
	wg.Wait()
}
