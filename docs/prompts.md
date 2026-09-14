📁 Atlas Implementation Prompts
Prompt 0 (Master Prompt)

Every other prompt should begin with this.

You are implementing a production-grade modular algorithmic trading platform called Atlas.

Read all architecture documents before implementing anything.

Architecture documents:

01-project-vision.md
02-functional-requirements.md
03-non-functional-requirements.md
04-domain-model.md
05-high-level-design.md
06-low-level-design.md
07-configuration-framework.md

General Rules

- Language: Go 1.25+
- Follow Clean Architecture
- SOLID Principles
- Prefer composition over inheritance
- Every package owns one responsibility
- Everything must be unit testable
- Never directly couple modules
- Use interfaces
- No globals
- Dependency Injection only
- Thread safe
- Context aware
- Extensive logging
- Every exported function documented
- Every package contains README.md
- Every module contains unit tests

Do not implement another module.

Only implement the requested module.

Use interfaces whenever another module is referenced.
Prompt 1

Repository Bootstrap

Create the production repository.

Implement

Makefile

Dockerfile

docker-compose

configs

scripts

cmd

internal

pkg

docs

test

Create build scripts.

Create linting.

Create formatting.

Create GitHub Actions.

Create logging package.

Nothing else.
Prompt 2

Configuration Framework

Implement Atlas configuration framework.

Support

YAML

Redis override

Validation

Versioning

Hot Reload

Dependency Graph

Compiled Configuration

Configuration cache

Configuration interfaces

Unit tests

Do not implement strategies.
Prompt 3

Scheduler

Implement scheduler.

Support

Jobs

Workflow triggers

Time based execution

No business logic.

Publish events only.

Support

1H

2H

4H

Daily jobs

Recovery

Tests.
Prompt 4

Workflow Engine

Implement Workflow Engine.

Responsibilities

ExecutionContext

Workflow lifecycle

Retry

Failure handling

Parallel execution

Workflow IDs

Execution tracing

No broker.

No indicators.
Prompt 5

Event Bus

Implement internal event bus.

Go Channels

Publish

Subscribe

Unsubscribe

Multiple subscribers

Buffered channels

Context cancellation

Tests

Benchmarks.
Prompt 6

Market Data

Implement Market Data Service.

Supports

Flattrade REST

Candle fetch

Symbol registry

Timeframe registry

MarketSnapshot

In-memory cache

Publish MarketUpdated events

Tests

Mock broker.
Prompt 7

Indicator Engine

Implement Indicator Engine.

Support

EMA

RSI

Supertrend

Incremental calculation

Indicator cache

Multiple instances

Multiple timeframes

Unit tests

Benchmarks

No strategy logic.
Prompt 8

Feature Engine

Implement Feature Engine.

Convert indicators into reusable features.

Support

Trend

Momentum

Trend Alignment

Price Position

Distance

Market Direction

Feature cache

Feature registry

Tests.
Prompt 9

Strategy Framework

Implement Strategy Framework.

Plugin architecture

Strategy registry

Lifecycle

Execution

Versioning

Compiled strategy

Hot reload

Context

No broker.

No paper trading.
Prompt 10

Expression Engine

This is one I think we should add. We haven't discussed it yet, but I think it's essential.

Instead of strategies manually evaluating nested AND/OR trees, we'll have a reusable engine.

Implement Expression Engine.

Support

AND

OR

NOT

MINIMUM

Comparisons

Greater

Less

Equal

Feature references

Expression tree

Compiled expressions

Evaluation

Unit tests.
Prompt 11

Trade Manager

Implement Trade Manager.

Trade lifecycle

Order mapping

Strategy positions

PnL

Trade journal

Position tracking

Multiple strategies

Multiple symbols

Configuration versioning

Tests.
Prompt 12

Risk Engine

Another new module I'd introduce.

Implement Risk Engine.

Support

Max trades

Daily loss

Cooldown

Capital allocation

Margin estimation

Quantity calculation

Future extensions

Unit tests.
Prompt 13

Trailing Engine

Implement Trailing Engine.

Support

Price

EMA

Supertrend

ATR

Hybrid

Policy interface

State machine

Tests.
Prompt 14

Paper Broker

Implement Paper Broker.

Virtual orders

Virtual positions

PnL

Slippage

Broker interface

Order updates

Redis persistence

Reports

Tests.
Prompt 15

Live Broker

Implement Flattrade Broker.

Authentication

REST

WebSocket

Order updates

Reconnect

Retry

Token refresh

Rate limiting

Interfaces

Tests.
Prompt 16

Redis Repository

Implement Redis layer.

Repositories

Trades

Orders

Configs

Reports

PnL

Transactions

TTL

Serialization

Tests.
Prompt 17

Reporting

Implement Reporting.

Daily report

Monthly report

Strategy report

Trade journal

Win rate

Profit factor

Drawdown

CSV export

JSON export.
Prompt 18

Oracle Deployment

Implement deployment.

Docker

Docker Compose

Health checks

Configuration

Restart policy

Logging

Monitoring

Build scripts

Oracle VM deployment.
📋 One More Thing I Want to Add

After thinking about the architecture overnight, I believe we're missing one critical service that most trading platforms have.

Strategy Orchestrator

Initially, we had:

Scheduler

↓

Workflow

↓

Strategies

I now think we should have:

Scheduler

↓

Workflow

↓

Strategy Orchestrator

↓

Strategies

Why?

Suppose we have

Silver

↓

EMA Pullback
Silver

↓

Breakout
Silver

↓

Trend Following

Suppose

all produce

BUY.

Who decides?

I think Strategy Orchestrator should.

Responsibilities

Receive all Signals

↓

Deduplicate

↓

Conflict Resolution

↓

Priority

↓

Cooldown

↓

Merge

↓

Trade Manager

Example

EMA

↓

BUY

Confidence

85

Breakout

↓

BUY

Confidence

65

Trend

↓

SELL

Confidence

55

Orchestrator

↓

BUY

Confidence

85

Trade Manager.

Another example

Suppose

EMA

already has

BUY

open.

Breakout

also

BUY.

Config

allowMultipleStrategies: false

Orchestrator

↓

Reject.

Or

mergePositions: true

Orchestrator

↓

Merge quantity.