// Package health exposes a lightweight HTTP health endpoint for VM and container probes.
package health

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// Snapshot is the JSON body for GET /healthz.
type Snapshot struct {
	Status          string `json:"status"`
	Redis           string `json:"redis"`
	Mode            string `json:"mode"`
	HasSessionToken bool   `json:"has_session_token"`
}

// Probe collects runtime health fields.
type Probe func(ctx context.Context) Snapshot

// Server serves GET /healthz in a background goroutine.
type Server struct {
	addr         string
	listenerAddr string
	probe        Probe
	srv          *http.Server
	mu           sync.Mutex
}

// NewServer returns a health HTTP server bound to addr (e.g. ":8080").
func NewServer(addr string, probe Probe) *Server {
	if addr == "" {
		addr = ":8080"
	}
	s := &Server{
		addr:  addr,
		probe: probe,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	s.srv = &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	return s
}

// Start begins listening in a goroutine. Non-blocking.
func (s *Server) Start() {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		_, _ = fmt.Fprintf(stderr(), "health server listen: %v\n", err)
		return
	}

	s.mu.Lock()
	s.listenerAddr = ln.Addr().String()
	s.mu.Unlock()

	go func() {
		if err := s.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			_, _ = fmt.Fprintf(stderr(), "health server: %v\n", err)
		}
	}()
}

// ListenerAddr returns the bound address after Start (e.g. 127.0.0.1:54321).
func (s *Server) ListenerAddr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listenerAddr
}

// Shutdown gracefully stops the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	srv := s.srv
	s.mu.Unlock()
	if srv == nil {
		return nil
	}
	return srv.Shutdown(ctx)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	snap := Snapshot{Status: "ok", Redis: "fail"}
	if s.probe != nil {
		snap = s.probe(ctx)
		if snap.Status == "" {
			snap.Status = "ok"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(snap)
}

// stderr is overridden in tests.
var stderr = func() interface{ Write([]byte) (int, error) } {
	return nopWriter{}
}

type nopWriter struct{}

func (nopWriter) Write(p []byte) (int, error) { return len(p), nil }
