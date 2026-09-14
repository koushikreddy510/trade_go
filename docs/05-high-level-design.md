docs/05-high-level-design.md
Atlas Architecture (HLD)

Version: 1.0

1. System Overview

Atlas is an event-driven trading platform built specifically for Indian commodity futures.

Unlike traditional bots, Atlas separates

Market Data
Indicators
Features
Strategies
Trade Management
Broker Execution

into independent modules.

Each module owns exactly one responsibility.

High Level View
                                   +--------------------------------+
                                   |        Oracle Cloud VM          |
                                   |     (Docker Compose Stack)      |
                                   +--------------------------------+

                 +---------------------------------------------------------+
                 |                                                         |
                 |                     Redis                               |
                 |---------------------------------------------------------|
                 | Configurations                                          |
                 | Trades                                                  |
                 | Orders                                                  |
                 | Tokens                                                  |
                 | Paper Positions                                         |
                 | Jobs                                                    |
                 | Reports                                                 |
                 +---------------------------------------------------------+

                                  ▲
                                  │

             Persistent State / Config / Recovery

                                  │

──────────────────────────────────────────────────────────────────────────────

                      Internal Event Bus (Go Channels)

──────────────────────────────────────────────────────────────────────────────

      ▲               ▲              ▲             ▲             ▲

      │               │              │             │             │

 Scheduler      Market Data    Indicator      Strategy     Trade Manager
                                  Engine         Engine

      │               │              │             │             │

      └───────────────┴──────────────┴─────────────┘

                               Broker

                          ┌──────────────┐
                          │              │
                    Paper Broker     Live Broker
                          │              │
                          │              ▼
                          │        Flattrade APIs
                          │
                          ▼
                     Virtual Orders
Why Event Driven?

Traditional Bot

Strategy

↓

Broker

↓

Position

↓

Indicators

↓

Market

Everything depends on everything.

Impossible to maintain.

Atlas

Market

↓

Event

↓

Indicators

↓

Event

↓

Features

↓

Event

↓

Strategy

↓

Event

↓

Trade

↓

Event

↓

Broker

Everything becomes loosely coupled.

Module Responsibilities
Scheduler

Responsibility

Only decides

WHEN something should happen.

Never

WHAT should happen.

Publishes

New Candle

Trailing Check

Token Refresh

Order Reconciliation

Nothing else.

Market Data Service

Consumes

New Candle Event

Fetches

Silver

Gold

Crude

Produces

MarketSnapshot

Stores latest candles in memory.

Publishes

MarketDataUpdated
Indicator Engine

Consumes

MarketDataUpdated

Calculates

EMA

RSI

Supertrend

Only once.

Publishes

IndicatorsUpdated
Feature Engine

Consumes

IndicatorsUpdated

Produces

Trend

Momentum

Pullback

Trend Alignment

Price Location

Publishes

FeaturesUpdated
Strategy Engine

Consumes

FeaturesUpdated

Executes

EMA Pullback

Trend Following

Breakout

Produces

BUY

SELL

EXIT

IGNORE
Trade Manager

Consumes

BUY

SELL

EXIT

Owns

Trades

Orders

PnL

Trailing SL

Risk Checks

Publishes

TradeOpened

TradeClosed

StopLossMoved

TargetReached
Broker

Consumes

Trade Events

Paper

↓

Redis

Live

↓

Flattrade

Publishes

OrderFilled

OrderRejected

OrderCancelled
Data Flow

Let's trace one complete trade.

Step 1

Scheduler

09:00

↓

1H Candle Closed
Step 2

Market Data

Fetch Silver

↓

Fetch Gold

↓

Fetch Crude
Step 3

Indicator Engine

For Silver

EMA20

EMA50

EMA200

RSI14

ST(10,3)
Step 4

Feature Engine

Produces

Trend = Bullish

Momentum = Strong

Pullback = Valid
Step 5

Strategy

Reads

Trend

Momentum

Pullback

Returns

BUY
Step 6

Trade Manager

Checks

Already open?

Risk?

Position Size?

Paper?

Creates Trade.

Step 7

Broker

Paper

↓

Redis

Live

↓

Flattrade

Step 8

Broker Update

WebSocket

↓

Trade Manager

↓

Redis

↓

PnL

Completed.

Complete Event Flow
Scheduler

↓

New Candle Event

↓

Market Data

↓

MarketDataUpdated

↓

Indicator Engine

↓

IndicatorsUpdated

↓

Feature Engine

↓

FeaturesUpdated

↓

Strategy Engine

↓

SignalGenerated

↓

Trade Manager

↓

OrderPlaced

↓

Broker

↓

OrderFilled

↓

TradeOpened

↓

PnL Updated

Notice

Nobody directly invokes anybody.

Everything reacts to Events.

Deployment Diagram
                Oracle Cloud VM

                      Docker

+----------------------------------------------------+

Redis

Strategy Engine

Trade Manager

Market Data

Scheduler

Broker

+----------------------------------------------------+

                     |

                     ▼

              Flattrade APIs

Notice

Everything runs on ONE VM.

Why not Microservices?

Because

Current Scale

3 Symbols

5 Strategies

doesn't justify

Kafka
gRPC
Kubernetes
Service Discovery

Instead

Independent modules

inside one binary.

Much simpler.

Internal Architecture
Atlas

↓

Scheduler

↓

Event Bus

↓

Services

↓

Repositories

↓

Redis

No service directly writes into another service.

Package Dependency
Scheduler

↓

Market

↓

Indicators

↓

Features

↓

Strategies

↓

Trade

↓

Broker

Dependency is

ONE WAY.

Never cyclic.

Event Ownership
Event	Publisher	Subscribers
New Candle	Scheduler	Market Data
Market Updated	Market Data	Indicator Engine
Indicators Updated	Indicator Engine	Feature Engine
Features Updated	Feature Engine	Strategy Engine
Signal Generated	Strategy Engine	Trade Manager
Trade Opened	Trade Manager	Broker, Reports
Order Filled	Broker	Trade Manager
Trade Closed	Trade Manager	Reports
Trade Lifecycle
NEW

↓

SIGNAL

↓

ENTRY_PENDING

↓

OPEN

↓

TRAILING

↓

EXIT_PENDING

↓

CLOSED

Only

Trade Manager

can change state.

Order Lifecycle
NEW

↓

PLACED

↓

ACCEPTED

↓

PARTIAL

↓

FILLED

↓

CLOSED
Failure Recovery

Suppose

Broker crashes.

Restart

↓

Read Redis

↓

Restore Trades

↓

Continue.

Memory

is cache.

Redis

is truth.

One thing I'd like to improve over the current design

After writing this HLD, I think there's one architectural improvement that will make the platform much cleaner.

Introduce a Workflow Engine (not AWS Step Functions)

Earlier we discussed schedulers and jobs. I now think we should distinguish three concepts:

Scheduler
        │
        ▼
Workflow Engine
        │
        ▼
Business Modules

For example, "evaluate a 1H strategy" is a workflow:

1H Candle Closed
        │
        ▼
Fetch Market Data
        │
        ▼
Calculate Indicators
        │
        ▼
Build Features
        │
        ▼
Evaluate Strategies
        │
        ▼
Process Signals
        │
        ▼
Execute Orders

The Scheduler only says when to start this workflow. The Workflow Engine orchestrates the sequence and handles retries or failures. This gives us a few advantages:

If later you add notifications, reporting, or audit logging, they're just extra workflow steps.
We can unit test an entire workflow independently of the scheduler.
We can run the exact same workflow for Paper Trading, Live Trading, and eventually Historical Replay by swapping only the broker implementation.

It remains much lighter than introducing AWS Step Functions or Temporal, but it gives us a clear orchestration layer.