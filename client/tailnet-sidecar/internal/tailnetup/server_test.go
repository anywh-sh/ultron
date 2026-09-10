package tailnetup

import (
	"bufio"
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

// startEchoListener plays the role of "something reachable inside the
// tailnet" — a plain TCP listener that echoes back whatever it reads,
// enough to prove bytes actually flow both directions through the splice.
func startEchoListener(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 4096)
				for {
					n, err := c.Read(buf)
					if n > 0 {
						if _, werr := c.Write(buf[:n]); werr != nil {
							return
						}
					}
					if err != nil {
						return
					}
				}
			}(conn)
		}
	}()
	return ln.Addr().String()
}

func TestServeSplicesBothDirections(t *testing.T) {
	target := startEchoListener(t)

	local, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer local.Close()

	srv := &Server{Target: target}
	go srv.Serve(local)

	conn, err := net.Dial("tcp", local.Addr().String())
	if err != nil {
		t.Fatalf("dial local listener: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Write([]byte("hello\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if line != "hello\n" {
		t.Fatalf("got %q, want %q", line, "hello\n")
	}
}

func TestServeClosesLocalConnWhenDialFails(t *testing.T) {
	local, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer local.Close()

	srv := &Server{
		Target: "unused:0",
		Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return nil, errors.New("simulated tailnet dial failure")
		},
	}
	go srv.Serve(local)

	conn, err := net.Dial("tcp", local.Addr().String())
	if err != nil {
		t.Fatalf("dial local listener: %v", err)
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 1)
	_, err = conn.Read(buf)
	if err == nil {
		t.Fatal("expected the connection to be closed after a failed dial, got a successful read")
	}
}
