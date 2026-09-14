📖 01-project-vision.md

This becomes the "why".

Problem Statement

Retail algorithmic trading platforms today suffer from one or more of the following:

tightly coupled strategies
difficult deployment
hardcoded indicators
broker dependent implementations
difficult testing
impossible paper trading
poor extensibility

Atlas solves these problems by introducing a modular event-driven architecture.

Goals

Primary goals

✓ Modular

✓ Lightweight

✓ Docker Native

✓ Event Driven

✓ Strategy Isolation

✓ Broker Agnostic

✓ Paper Trading

✓ Configuration Driven

✓ Oracle Cloud Deployable

Non Goals

Atlas is NOT

HFT
Tick Trading
ML Framework
Charting Software
TradingView Alternative
Design Philosophy

The platform should require writing strategy code only.

Everything else should already exist.

📖 02 Functional Requirements

This is where all the requirements we discussed go.

Strategy Engine

Support

Multiple Strategies
Multiple Symbols
Multiple Timeframes
Parallel Execution
Versioned Configurations
Indicators

Support

EMA

RSI

Supertrend

Multiple instances

Example

EMA20

EMA50

EMA200

EMA21

EMA55

without recalculating duplicates.

Paper Trading

Paper Broker

Trade Tracking

PnL

Virtual Positions

Virtual Orders

Live Trading

Broker Interface

Order Placement

Order Modification

Trailing SL

Order Updates

Configuration

Hot Reload

Versioning

Enable Disable

Indicator Parameters

Risk Parameters

Trailing Parameters

Trade Management

Strategy Isolation

Trailing Policies

Position Tracking

PnL

Trade Journal

📖 Next Document

Tomorrow's biggest document

05-high-level-design.md

This is where the real engineering begins.

High Level Architecture

This is the architecture I think we'll freeze.

                           Oracle Cloud

+-------------------------------------------------------------------+

                       Docker Compose

+-------------------------------------------------------------------+

               +-------------------------------+
               |           Redis               |
               +-------------------------------+

                        ▲
                        │
             State / Config / Events

                        │

+---------------------------------------------------------------+

              Internal Event Bus (Go Channels)

+---------------------------------------------------------------+

         ▲              ▲             ▲            ▲

         │              │             │            │

 Scheduler      Market Data      Trade Manager   Broker

         │              │             │            │

         └──────────────┼─────────────┘

                        │

                Indicator Engine

                        │

                 Feature Engine

                        │

                 Strategy Engine

                        │

                  Signal Engine

                        │

                  Paper/Live Broker

                        │

                   Flattrade API

+---------------------------------------------------------------+
Code Flow

Example

Scheduler

↓

New Candle Event

↓

Market Data Fetch

↓

Indicator Engine

↓

EMA

↓

RSI

↓

Supertrend

↓

Feature Engine

↓

Trend

↓

Momentum

↓

Pullback

↓

Strategy

↓

BUY

↓

Trade Manager

↓

Paper Broker

↓

Trade Stored

↓

PnL Updated
Live Flow
Scheduler

↓

Market Data

↓

Indicators

↓

Features

↓

Strategy

↓

Trade Manager

↓

Broker

↓

Flattrade

↓

Order Update WS

↓

Trade Manager

↓

Redis
Why this architecture?

Because every module has exactly one responsibility.

Module	Responsibility
Scheduler	Time based execution
Market Data	Fetch candles
Indicator Engine	Calculate indicators
Feature Engine	Convert indicators into reusable features
Strategy Engine	Generate BUY/SELL/EXIT signals
Trade Manager	Own lifecycle of trades
Broker	Execute orders
Paper Broker	Simulate execution
Redis	Persistent state
Event Bus	Internal communication

No module knows implementation details of another.




One thing I'd like to change from our earlier discussions before we continue.

Atlas is not a collection of services.

Atlas is an Execution Engine.

Everything else becomes plugins around it.

This subtle shift simplifies the architecture tremendously.

Updated Architecture

Instead of

Scheduler

↓

Market Data

↓

Indicators

↓

Features

↓

Strategies

↓

Trade Manager

Think of Atlas as

                    Atlas Engine

                           │

         ┌─────────────────┼─────────────────┐

         ▼                 ▼                 ▼

     Data Source      Strategy       Execution Mode

         │                 │                 │

         ▼                 ▼                 ▼

   Flattrade        EMA Pullback      Live

                    Breakout          Simulation

                    Trend             Replay

                           │

                           ▼

                     Trade Manager

Everything becomes a plugin.

Atlas Core

The Engine should own only these modules.

Scheduler

Workflow Engine

Execution Context

Event Bus

Trade Manager

Repositories

Configuration

Everything else

Broker

Indicators

Features

Strategies

Trailing

Risk

becomes a plugin.

New Repository Layout

I think this is much cleaner.

atlas

cmd/

    atlas/

plugins/

    broker/

        flattrade/

        paper/

    indicators/

        ema/

        rsi/

        supertrend/

    features/

        trend/

        momentum/

        pullback/

    strategies/

        ema_pullback/

        breakout/

        trend_follow/

    trailing/

        supertrend/

        ema/

        price/

internal/

    engine/

    workflow/

    scheduler/

    context/

    trade/

    events/

    config/

    repository/

pkg/

docs/

configs/

Notice

Everything customizable becomes a plugin.

Execution Engine

This becomes the heart.

Engine

↓

Workflow

↓

ExecutionContext

↓

Processors

↓

TradeManager

Nothing else.

Processor Chain

After thinking about it for a while,

I think we should stop thinking about services.

Instead

Everything becomes a Processor.

Example

Workflow

↓

Processor

↓

Processor

↓

Processor

Example

Market Processor

↓

Indicator Processor

↓

Feature Processor

↓

Strategy Processor

↓

Execution Processor

Each implements

type Processor interface {

    Process(ctx *ExecutionContext) error

}

This is exactly like Spring Filters.

Complete Pipeline

This is the execution pipeline.

Scheduler

↓

Workflow

↓

Execution Context

↓

Market Processor

↓

Indicator Processor

↓

Feature Processor

↓

Strategy Processor

↓

Signal Processor

↓

Trade Processor

↓

Execution Processor

↓

Reporting Processor

Every box

is just

a Processor.

Why this is better

Suppose tomorrow

you add

Telegram notifications.

Instead of

changing Trade Manager

You add

Notification Processor

Done.

Suppose

later

you add

AI validation.

Signal

↓

AI Processor

↓

Trade

Done.

No redesign.

Execution Context

I want this to become much richer.

type ExecutionContext struct {

    WorkflowID string

    ConfigVersion int

    Symbol Symbol

    Timeframe Timeframe

    ExecutionMode Mode

    Runtime RuntimeContext

    Market MarketSnapshot

    Indicators map[string]Indicator

    Features map[string]Feature

    Signals []Signal

    Trades []Trade

    Metadata map[string]any

}

Everything

passes

one object.

Runtime Context

New object.

type RuntimeContext struct {

    StartTime

    Logger

    Metrics

    EventBus

    Cancellation

}

Now

processors don't need globals.

Configuration Compiler

This is another service I think we need.

Instead of

reading YAML

everywhere.

Workflow

loads

YAML

↓

Compile

↓

Runtime Config

↓

Execution

Like

Java compiler.

Runtime Config

Instead of

EMA=20

Runtime

gets

CompiledIndicator

CompiledFeature

CompiledStrategy

CompiledTrailing

Zero parsing

during execution.

Indicator Registry

Instead of

EMA20

EMA50

Registry

returns

Get("ema_fast")

Everything by ID.

Feature Registry

Same.

Get("trend")

↓

Feature
Strategy Registry
Get("ema_pullback")

↓

Compiled Strategy
Processor Registry

Even processors become configurable.

pipeline:

    - market

    - indicators

    - features

    - strategies

    - trade

    - reports

One day

pipeline:

    - market

    - ai

    - strategies

    - trade

No code.

Thread Model

This deserves a separate document.

After a lot of thinking,

I don't want

100 goroutines.

Instead

Main

↓

Workflow Pool

↓

Strategy Pool

↓

Broker Pool

Three pools.

That's all.

Redis

I want to redesign keys.

Instead of

trade:

order:

Let's namespace

everything.

atlas

    runtime

        workflow

        scheduler

    config

    broker

    simulation

    reports

    strategy

    trade

    metrics

Much cleaner.

Simulation

Now

the exciting part.

Instead of

Paper Broker

Simulation

gets

its own engine.

Trade

↓

Simulation

↓

Virtual Position

↓

PnL

↓

Reports

No broker.

Replay

Replay

becomes

another

Market Provider.

Market Provider

↓

Live

↓

Replay

Nothing changes.

Hot Reload

This is something I think is missing from almost every trading framework.

Suppose

config changes.

Workflow

already running.

Continue.

New workflow

↓

New Config.

Exactly what Kubernetes does.

Failure Recovery

Every workflow

writes checkpoints.

Workflow

↓

Market Done

↓

Indicators Done

↓

Strategies Done

Crash.

Restart.

Resume.

Logging

Every log

contains

WorkflowID

StrategyID

TradeID

Processor

Duration

Amazing

for debugging.

Metrics

Every processor

publishes

Execution Time

Errors

Memory

Latency

Later

Grafana.

Where I think Atlas can become really unique

This is something I haven't seen in retail algo platforms.

Decision Journal

Every single trade should record why it was taken.

Instead of just storing:

BUY @ 102345

Atlas stores a complete decision snapshot.

Example:

{
  "strategy": "ema_pullback",
  "symbol": "SILVER",
  "timeframe": "1H",
  "decision": "BUY",
  "confidence": 87,
  "features": {
    "trend": "BULLISH",
    "momentum": 68,
    "pullback": true,
    "supertrend": "GREEN"
  },
  "indicatorSnapshot": {
    "ema_fast": 102210,
    "ema_slow": 101980,
    "rsi": 64.2
  },
  "configVersion": 12
}

Six months later, when you're reviewing a trade, you don't just know what happened—you know why the engine believed it should enter.

This also becomes incredibly powerful for simulation:

Compare winning vs losing trades.
See which features were common.
Tune only one parameter.
Replay the exact decision with a newer strategy version.

I think this will become one of Atlas's strongest features because it turns every trade into a learning artifact instead of just a PnL entry.