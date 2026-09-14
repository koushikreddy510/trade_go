package domain

import (
	"fmt"
	"strings"
)

// ExecutionMode selects how trades are executed: simulation, paper, or live broker.
type ExecutionMode string

const (
	ExecutionSimulation ExecutionMode = "SIMULATION"
	ExecutionPaper      ExecutionMode = "PAPER"
	ExecutionLive       ExecutionMode = "LIVE"
)

// ParseExecutionMode converts a config string into an ExecutionMode.
func ParseExecutionMode(s string) (ExecutionMode, error) {
	switch strings.ToUpper(strings.TrimSpace(s)) {
	case string(ExecutionSimulation):
		return ExecutionSimulation, nil
	case string(ExecutionPaper):
		return ExecutionPaper, nil
	case string(ExecutionLive):
		return ExecutionLive, nil
	default:
		return "", fmt.Errorf("domain: unknown execution mode %q", s)
	}
}

// String returns the canonical mode label.
func (m ExecutionMode) String() string {
	return string(m)
}
