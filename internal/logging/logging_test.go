package logging

import (
	"context"
	"testing"
)

func TestNew(t *testing.T) {
	log := New("test")
	if log == nil {
		t.Fatal("expected non-nil logger")
	}
	log.Info("test message", "key", "value")
}

func TestWith(t *testing.T) {
	log := New("test").With("symbol", "SILVER")
	log.Info("with fields")
}

func TestFromContext(t *testing.T) {
	log := New("ctx-test")
	ctx := log.WithContext(context.Background())

	got := FromContext(ctx)
	if got == nil {
		t.Fatal("expected logger from context")
	}

	defaultLog := FromContext(context.Background())
	if defaultLog == nil {
		t.Fatal("expected default logger")
	}
}
