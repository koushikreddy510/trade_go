06 - Low Level Design (LLD)
Domain Model

First, let's identify our business entities.

Configuration
        │
        ▼
Scheduler
        │
        ▼
Workflow
        │
        ▼
Market Snapshot
        │
        ▼
Indicator Snapshot
        │
        ▼
Feature Snapshot
        │
        ▼
Strategy
        │
        ▼
Signal
        │
        ▼
Trade
        │
        ▼
Order
        │
        ▼
Position

Notice

Trade != Position != Order

Domain Objects
Symbol
type Symbol struct {

    Exchange string

    Token string

    Name string

    TickSize float64

    LotSize int

}

Example

MCX

↓

SILVERM

↓

26000
Candle
type Candle struct {

    Time time.Time

    Open float64

    High float64

    Low float64

    Close float64

    Volume int64

}

Nothing broker specific.

MarketSnapshot
Silver

↓

1H

↓

Last 500 candles
type MarketSnapshot struct {

    Symbol Symbol

    Timeframe Timeframe

    Candles []Candle

}
Indicator Snapshot

This is extremely important.

Instead of

EMA20

we create

Indicator Instance
type IndicatorSnapshot struct {

    Symbol

    Timeframe

    Name

    Parameters

    Values

}

Example

EMA

20

↓

[100.2

101.4

101.8]
Feature Snapshot

Strategies never receive indicators.

They receive

type FeatureSnapshot struct {

    Trend Trend

    Momentum Momentum

    Pullback Pullback

    TrendStrength float64

    PriceLocation PriceLocation

}
Signal

Strategies produce

type Signal struct {

    StrategyID string

    Symbol Symbol

    Action BUY|SELL|EXIT|IGNORE

    Confidence int

    StopLoss float64

    Quantity int

    Metadata map[string]string

}

Notice

No Broker.

Trade

This is the heart of the platform.

type Trade struct {

    ID string

    StrategyID string

    ConfigVersion int

    Symbol Symbol

    State TradeState

    EntryPrice float64

    ExitPrice float64

    StopLoss float64

    TrailingStop float64

    Quantity int

    EntryOrderID string

    ExitOrderID string

    PnL float64

}
Order

Trade

can have

multiple Orders.

type Order struct {

    ID string

    TradeID string

    BrokerOrderID string

    Type ENTRY|SL|TARGET|EXIT

    Status

}
Position

Position belongs to Trade.

Not Symbol.

type Position struct {

    TradeID

    Qty

    AvgPrice

    Side

}
Configuration Model

This is where I changed my opinion.

Instead of

Strategy Config

we should have

Platform Config

↓

contains

Strategies

↓

contains

Indicators

↓

contains

Trailing

Everything nested.

Example

platform:

    broker:

    redis:

    scheduler:

strategies:

    ema_pullback:

    breakout:

symbols:

    silver:

    gold:
Redis Design

Now comes the interesting part.

Initially

I thought

Trades

Now

I think

Redis should look like

Atlas

↓

Configs

↓

Runtime

↓

Reports

↓

Events
Config
atlas:config

Stores

Entire YAML.

Versioned.

Token
atlas:broker:flattrade:token
Strategy Config
atlas:strategy:ema_pullback
Active Trades
atlas:trade:active

Contains

Trade IDs

Each Trade

atlas:trade:{id}

Order

atlas:order:{id}

Strategy Position

Instead of

Silver Position

I think

Strategy Position
atlas:position:ema_pullback:silver

Much better.

Paper Position

atlas:paper:position:{strategy}

PnL

atlas:pnl:daily

atlas:pnl:monthly

Reports

atlas:report:{date}

Jobs

atlas:job:scheduler
Redis Data Structures

Not everything should be JSON.

Config

String

Trades

Hash

Orders

Hash

PnL

Sorted Set

Reports

JSON

Events

Streams

Only if

we need persistence.

Otherwise

internal Event Bus.

Runtime Cache

Memory

Only.

Candles

Indicators

Features

Never Redis.

Reason

Rebuildable.

Trade Repository

Interface

type TradeRepository interface {

    Save()

    Update()

    Find()

    Active()

}

Redis implementation.

Config Repository
type ConfigRepository interface {

    Load()

    Reload()

    Version()

}
Order Repository
type OrderRepository interface {

    Save()

    Update()

    Find()

}
Position Repository
type PositionRepository interface {

    Active()

    Save()

}
Package Layout
internal

    config

    scheduler

    workflow

    broker

    market

    indicator

    feature

    strategy

    trade

    order

    position

    paper

    report

    repository

    cache

    events
Service Responsibilities
Config Service

Responsibilities

Load YAML

↓

Merge Redis

↓

Version

↓

Hot Reload

Produces

ConfigUpdated
Scheduler

Consumes

Config

Produces

WorkflowStarted
Workflow Engine

Consumes

WorkflowStarted

Executes

Fetch

Indicators

Features

Strategies

Trades

One Workflow.

Market Service

Produces

MarketSnapshot
Indicator Service

Produces

IndicatorSnapshot
Feature Service

Produces

FeatureSnapshot
Strategy Service

Produces

Signal
Trade Service

Produces

Trade
Broker

Produces

Order
Configuration Versioning

This deserves a separate design.

Suppose

Current

EMA20

Trade opens.

Now

Config

↓

EMA30

Don't change Trade.

Trade stores

Config Version 3

Strategy loads

Version 3

until exit.

Only

next Trade

gets

Version 4.

Workflow Diagram
Scheduler

↓

Workflow

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

↓

Report

Every workflow

is isolated.

One thing I want to improve before we start coding

After writing the LLD, I think we should introduce one more abstraction that I didn't have in the HLD:

Execution Context

Instead of every service passing around multiple objects (MarketSnapshot, IndicatorSnapshot, FeatureSnapshot, Config, Timeframe, Symbol, etc.), the Workflow Engine should build a single immutable object:

type ExecutionContext struct {
    WorkflowID      string
    Symbol          Symbol
    Timeframe       Timeframe
    ConfigVersion   int

    Market          MarketSnapshot
    Indicators      IndicatorSnapshot
    Features        FeatureSnapshot

    Timestamp       time.Time
}

Every module receives this context and enriches it without mutating previous state (or returns a derived context). This gives us:

Easy logging (WorkflowID follows the entire pipeline).
Easy debugging.
Deterministic paper trading.
Deterministic historical replay in the future.
Much simpler unit tests.