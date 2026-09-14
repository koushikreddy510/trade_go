// Package logging provides a structured slog wrapper for Atlas.
package logging

import (
	"context"
	"log/slog"
	"os"
)

// Logger wraps slog.Logger with convenience methods for structured logging.
type Logger struct {
	inner *slog.Logger
}

// New creates a new Logger with JSON output to stderr at info level.
func New(name string) *Logger {
	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})
	return &Logger{
		inner: slog.New(handler).With("component", name),
	}
}

// With returns a new Logger with additional structured fields.
func (l *Logger) With(args ...any) *Logger {
	return &Logger{inner: l.inner.With(args...)}
}

// Debug logs at debug level.
func (l *Logger) Debug(msg string, args ...any) {
	l.inner.Debug(msg, args...)
}

// Info logs at info level.
func (l *Logger) Info(msg string, args ...any) {
	l.inner.Info(msg, args...)
}

// Warn logs at warn level.
func (l *Logger) Warn(msg string, args ...any) {
	l.inner.Warn(msg, args...)
}

// Error logs at error level.
func (l *Logger) Error(msg string, args ...any) {
	l.inner.Error(msg, args...)
}

// WithContext returns a context carrying the logger for downstream use.
func (l *Logger) WithContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, loggerKey{}, l)
}

// FromContext retrieves a Logger from context, or a default if none is set.
func FromContext(ctx context.Context) *Logger {
	if l, ok := ctx.Value(loggerKey{}).(*Logger); ok {
		return l
	}
	return New("default")
}

type loggerKey struct{}
