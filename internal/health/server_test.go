package health_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/koushik-bangaru/atlas/internal/health"
)

func TestHealthzReturnsSnapshot(t *testing.T) {
	t.Parallel()

	probe := func(ctx context.Context) health.Snapshot {
		return health.Snapshot{
			Status:          "ok",
			Redis:           "ok",
			Mode:            "PAPER",
			HasSessionToken: true,
		}
	}

	srv := health.NewServer("127.0.0.1:0", probe)
	srv.Start()
	t.Cleanup(func() {
		_ = srv.Shutdown(context.Background())
	})

	addr := srv.ListenerAddr()
	if addr == "" {
		t.Fatal("listener addr empty")
	}

	var resp *http.Response
	var err error
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err = http.Get("http://" + addr + "/healthz")
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}

	var snap health.Snapshot
	if err := json.Unmarshal(body, &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if snap.Status != "ok" {
		t.Fatalf("status = %q, want ok", snap.Status)
	}
	if snap.Redis != "ok" {
		t.Fatalf("redis = %q, want ok", snap.Redis)
	}
	if snap.Mode != "PAPER" {
		t.Fatalf("mode = %q, want PAPER", snap.Mode)
	}
	if !snap.HasSessionToken {
		t.Fatal("has_session_token = false, want true")
	}
}
