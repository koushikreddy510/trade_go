package domain

import "time"

// WorkflowType classifies why a workflow was started (market cycle, trailing, etc.).
type WorkflowType string

const (
	WorkflowMarket      WorkflowType = "MARKET"
	WorkflowTrading     WorkflowType = "TRADING"
	WorkflowTrailing    WorkflowType = "TRAILING"
	WorkflowRisk        WorkflowType = "RISK"
	WorkflowBroker      WorkflowType = "BROKER"
	WorkflowReporting   WorkflowType = "REPORTING"
	WorkflowMaintenance WorkflowType = "MAINTENANCE"
)

// WorkflowStatus tracks lifecycle state from creation through completion or failure.
type WorkflowStatus string

const (
	WorkflowCreated   WorkflowStatus = "CREATED"
	WorkflowQueued    WorkflowStatus = "QUEUED"
	WorkflowRunning   WorkflowStatus = "RUNNING"
	WorkflowCompleted WorkflowStatus = "COMPLETED"
	WorkflowArchived  WorkflowStatus = "ARCHIVED"
	WorkflowFailed    WorkflowStatus = "FAILED"
	WorkflowAborted   WorkflowStatus = "ABORTED"
)

// Workflow is the unit of work orchestrated by the workflow engine.
type Workflow struct {
	ID            string
	Type          WorkflowType
	Symbol        Symbol
	Timeframe     Timeframe
	Status        WorkflowStatus
	StartedAt     time.Time
	CompletedAt   time.Time
	ConfigVersion int
}
