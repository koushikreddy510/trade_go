package domain

import "testing"

func TestParseExecutionMode(t *testing.T) {
	tests := []struct {
		input   string
		want    ExecutionMode
		wantErr bool
	}{
		{"SIMULATION", ExecutionSimulation, false},
		{"simulation", ExecutionSimulation, false},
		{" PAPER ", ExecutionPaper, false},
		{"LIVE", ExecutionLive, false},
		{"BACKTEST", "", true},
		{"", "", true},
	}

	for _, tt := range tests {
		got, err := ParseExecutionMode(tt.input)
		if tt.wantErr {
			if err == nil {
				t.Errorf("ParseExecutionMode(%q) expected error", tt.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseExecutionMode(%q) unexpected error: %v", tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("ParseExecutionMode(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}
