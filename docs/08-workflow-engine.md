📄 docs/08-workflow-engine.md
Workflow Engine & Execution Pipeline

Version: 1.0

1. Philosophy

The Scheduler should never execute business logic.

The Strategy should never fetch market data.

The Broker should never decide risk.

Every service owns one responsibility.

The Workflow Engine becomes the orchestrator.

Scheduler

↓

Workflow Engine

↓

Business Services

↓

Trade Manager

↓

Broker
2. Workflow Types

Atlas supports multiple workflow types.

Market Workflow

Trading Workflow

Trailing Workflow

Risk Workflow

Broker Workflow

Reporting Workflow

Maintenance Workflow
Market Workflow

Runs every

1H

2H

4H

Responsible for

Fetch Candles

↓

Indicators

↓

Features

↓

Strategies
Trailing Workflow

Runs every

30 sec

or

1 min

Only for

OPEN Trades

Responsibilities

Evaluate Trailing Policy

↓

Move SL

↓

Modify Order
Broker Workflow

Runs on

WebSocket Event

or

Reconnect

Responsibilities

Order Update

↓

Trade Manager
Reporting Workflow

Runs

23:35 IST

Responsibilities

PnL

↓

Reports

↓

CSV

↓

Redis
3. Workflow Lifecycle

Every workflow follows the same lifecycle.

CREATED

↓

QUEUED

↓

RUNNING

↓

COMPLETED

↓

ARCHIVED

Failure

RUNNING

↓

FAILED

↓

RETRY

↓

FAILED

↓

ABORTED
Workflow Object
type Workflow struct {

    ID string

    Type WorkflowType

    Symbol Symbol

    Timeframe Timeframe

    Status WorkflowStatus

    StartedAt time.Time

    CompletedAt time.Time

    ConfigVersion int

}
4. Execution Context

Every service receives exactly one object.

type ExecutionContext struct {

    WorkflowID string

    ConfigVersion int

    Symbol Symbol

    Timeframe Timeframe

    ExecutionMode Mode

    Timestamp time.Time

    MarketSnapshot

    IndicatorSnapshot

    FeatureSnapshot

}

Notice

No service receives

Redis

Broker

Scheduler
Why?

Because

Function

↓

Input

↓

Output

Pure.

Very testable.

5. Execution Pipeline

This is the heart of Atlas.

                    Scheduler

                        │

                        ▼

              Create Workflow

                        │

                        ▼

           Build ExecutionContext

                        │

                        ▼

             Market Data Service

                        │

                        ▼

             Indicator Engine

                        │

                        ▼

             Feature Engine

                        │

                        ▼

            Strategy Orchestrator

                        │

        ┌───────────────┴───────────────┐

        ▼                               ▼

 Strategy A                     Strategy B

        ▼                               ▼

        └───────────────┬───────────────┘

                        ▼

             Signal Orchestrator

                        ▼

                Risk Engine

                        ▼

              Trade Manager

                        ▼

                  Broker

                Paper / Live

                        ▼

                  Order Update
6. Strategy Orchestrator

This is a service we didn't initially have, but I now think it's essential.

Responsibilities

Load enabled strategies

↓

Run in parallel

↓

Collect Signals

↓

Resolve conflicts

↓

Pass to Trade Manager
Strategy Execution

Each strategy executes independently.

Silver

↓

Workflow

↓

Strategy A

↓

BUY
Silver

↓

Workflow

↓

Strategy B

↓

IGNORE
Silver

↓

Workflow

↓

Strategy C

↓

SELL

Strategy Orchestrator

collects

all.

7. Parallel Execution

This is where Go becomes extremely powerful.

Workflow

↓

goroutine

↓

Strategy A
Workflow

↓

goroutine

↓

Strategy B
Workflow

↓

goroutine

↓

Strategy C

WaitGroup

↓

Collect Results.

Worker Pool

I don't want unlimited goroutines.

Instead

Strategy Pool

Workers = CPU × 2

Example

8 CPU

↓

16 Workers

Every strategy

becomes Job.

Market Data Pool

Separate.

Fetch Silver

↓

Worker
Fetch Gold

↓

Worker
Fetch Crude

↓

Worker
Indicator Pool

Separate.

EMA

↓

Worker
RSI

↓

Worker
Supertrend

↓

Worker

Notice

Pools

don't interfere.

8. Failure Isolation

Suppose

Strategy

panics.

Recover

↓

Log

↓

IGNORE

Other strategies

continue.

Broker

fails.

Retry

↓

Backoff

↓

Circuit Breaker

Market Data

fails.

Retry

↓

Abort Workflow
9. Workflow Locking

This is important.

Suppose

1H

Workflow

still running.

Another

1H

starts.

Not allowed.

Redis Lock

workflow:1H:silver

Already exists.

↓

Skip.

10. Idempotency

Every workflow

gets

WorkflowID

Every Trade

stores

WorkflowID

Duplicate execution?

Ignore.

11. Graceful Shutdown

SIGTERM

↓

Stop Scheduler

↓

No new workflows

↓

Finish running

↓

Persist state

↓

Exit

12. Crash Recovery

Restart

↓

Redis

↓

Load

Active Trades

↓

Reconnect Broker

↓

Resume.

13. Execution Modes

One engine.

Three modes.

Historical Replay

↓

Paper

↓

Live

Only Broker changes.

14. Execution Context Flow
Scheduler

↓

ExecutionContext

↓

Market

↓

Indicators

↓

Features

↓

Strategies

↓

Signals

↓

Trade

↓

Broker

One object

travels

entire pipeline.

15. Workflow Events
WorkflowStarted

↓

MarketFetched

↓

IndicatorsCalculated

↓

FeaturesCalculated

↓

StrategiesCompleted

↓

RiskCompleted

↓

TradeCompleted

↓

WorkflowCompleted

Excellent for

logging.

16. Logging

Every log

contains

WorkflowID

StrategyID

TradeID

Symbol

Timeframe

Example

Workflow=abc123

Strategy=EMA_PULLBACK

Trade=xyz456

Silver

BUY

Finding bugs

becomes easy.

17. Metrics

Each workflow records

Execution Time

Indicator Time

Strategy Time

Broker Time

Total Time

Memory

Errors

Future

Prometheus.

18. State Machine
Scheduler

↓

Workflow

↓

ExecutionContext

↓

Services

↓

Trade

↓

Broker

↓

Completed

Everything

deterministic.

19. Redis Design (Updated)

After writing this document, I realized our Redis design can be improved significantly.

Instead of using Redis just as a key-value store, we should organize it by bounded contexts, similar to packages.

atlas
│
├── config
│
├── workflows
│
├── scheduler
│
├── broker
│
├── market
│
├── indicators
│
├── features
│
├── strategies
│
├── trades
│
├── orders
│
├── reports
│
└── metrics

Example:

atlas:config:current

atlas:workflow:active

atlas:trade:active

atlas:trade:{tradeId}

atlas:order:{orderId}

atlas:strategy:{strategyId}

atlas:broker:token

atlas:report:daily:2026-08-01

Everything has a clear ownership.

20. One Major Change I'd Like to Make

This is probably the biggest architectural improvement I'd suggest after writing all the documents so far.

Replace the Feature Engine with a Signal Processing Pipeline

Originally we had:

Indicators

↓

Features

↓

Strategies

I think a more flexible model is:

Indicators

↓

Processors

↓

Features

↓

Processors

↓

Strategies

↓

Processors

↓

Signals

Where Processors are reusable plugins.

Examples:

Trend Processor

Momentum Processor

Multi-Timeframe Alignment Processor

Noise Filter

Risk Filter

Confidence Scorer

Conflict Resolver

This allows us to build a pipeline similar to middleware.

For example:

Indicators
      │
      ▼
Trend Processor
      │
      ▼
Momentum Processor
      │
      ▼
Pullback Processor
      │
      ▼
Strategy
      │
      ▼
Confidence Processor
      │
      ▼
Risk Processor
      │
      ▼
Trade Manager

Each processor has one responsibility and can be enabled or disabled via configuration.

I think this is cleaner than making the Feature Engine responsible for every transformation, and it aligns well with your requirement of keeping the indicator set small while allowing increasingly sophisticated decision-making over time.