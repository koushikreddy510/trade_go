Trade Manager (OMS)

Order & Trade Lifecycle Manager

1. Purpose

Trade Manager is the single owner of every trade.

Nothing else is allowed to

open trades
close trades
move stop losses
update pnl
update positions

Not even the Broker.

2. Responsibilities

Trade Manager owns

Trade Lifecycle

Order Lifecycle

Position Lifecycle

PnL

Trailing SL

Targets

Configuration Version

Order Correlation

Recovery

Paper Trading State

Risk Validation

Broker Synchronization
3. What it DOES NOT own

Trade Manager should NOT

Fetch Candles

Calculate EMA

Calculate RSI

Know Supertrend

Know Strategies

Know Flattrade

It only receives

Signals

Orders

Broker Updates
4. Biggest Design Decision

One thing I'd like to change from almost every retail trading bot.

We DO NOT track positions.

We track

Trades

A Trade owns

Orders

Position

PnL

Risk

Trailing

Think of it like this

Trade

↓

Entry Order

↓

Position

↓

SL Order

↓

Exit Order

↓

Completed

Everything belongs to one Trade.

5. Trade Aggregate

This becomes the Aggregate Root.

Trade

├── Orders
│
├── Position
│
├── Risk
│
├── Trailing
│
├── PnL
│
└── Metadata

Nothing can modify Position directly.

Only Trade.

6. Trade State Machine
NEW

↓

SIGNAL_RECEIVED

↓

VALIDATED

↓

ENTRY_ORDER_CREATED

↓

ENTRY_PENDING

↓

OPEN

↓

SL_PLACED

↓

TARGET_PLACED

↓

TRAILING

↓

EXIT_PENDING

↓

CLOSED

↓

ARCHIVED

Failure

ENTRY_PENDING

↓

REJECTED

↓

CANCELLED
7. Order State Machine

Each order

NEW

↓

SENT

↓

OPEN

↓

PARTIAL

↓

FILLED

↓

CANCELLED

↓

REJECTED

Orders are independent.

Trades are not.

8. Position State

Position is derived.

Never edited manually.

OPEN

↓

Quantity

↓

Average Price

↓

PnL

↓

Closed
9. Trade Object
type Trade struct {

    TradeID string

    WorkflowID string

    StrategyID string

    ConfigVersion int

    Symbol Symbol

    Side Side

    Quantity int

    State TradeState

    EntryOrderID string

    StopLossOrderID string

    TargetOrderID string

    ExitOrderID string

    Position Position

    Risk RiskState

    Trailing TrailingState

    Metadata map[string]string
}

Notice

No Broker.

10. Position Object
type Position struct {

    AvgPrice float64

    Quantity int

    RealizedPnL float64

    UnrealizedPnL float64

    EntryTime time.Time

    ExitTime time.Time
}
11. Order Object
type Order struct {

    BrokerOrderID string

    TradeID string

    Type OrderType

    Status OrderStatus

    FilledQuantity int

    AveragePrice float64

}
12. Order Correlation

This is the most important feature.

Instead of

Broker Order

↓

Trade?

We'll maintain

Order Registry
Broker Order

↓

TradeID

↓

StrategyID

↓

Purpose

Redis

atlas:orders:broker:{brokerOrderId}

↓

TradeID

↓

StrategyID

↓

ENTRY

Now

Broker WS

↓

Order Filled

↓

Lookup

↓

Trade

↓

Update

O(1)

13. Multiple Strategies

Suppose

Silver

EMA

↓

BUY

Breakout

BUY

Trend

SELL

Trade Manager stores

Trade

001

Strategy EMA
Trade

002

Strategy Breakout
Trade

003

Strategy Trend

No conflict.

Each owns

its own

Position.

14. Strategy Position

Redis

atlas:position:

EMA_PULLBACK

SILVER

Another

atlas:position:

BREAKOUT

SILVER

Never

Silver Position
15. Broker Position

Broker

shows

Silver

4 Lots

Atlas

shows

EMA

2 Lots

Breakout

1 Lot

Trend

1 Lot

Exactly what we wanted.

16. Broker Sync

On startup

Load Trades

↓

Broker Position

↓

Compare

↓

Repair

If mismatch

↓

Alert

Never silently modify.

17. Trailing Engine

Trade owns

TrailingPolicy

Every minute

OPEN Trade

↓

Trailing Policy

↓

New SL?

↓

Modify Order
18. Paper Trading

Paper Broker

returns

Filled

Trade Manager

doesn't know

whether

Paper

or

Live.

Same interface.

19. Recovery

Crash

↓

Redis

↓

Load Active Trades

↓

Load Orders

↓

Reconnect Broker

↓

Resume

Nothing lost.

20. Redis Design

This is where I want to redesign Redis completely.

Instead of random keys

We'll organize

by Aggregate.

atlas

    trades

    positions

    orders

    reports

    configs

    broker

    scheduler

    workflows
Trade
atlas:trade:{tradeId}

Hash

TradeID

StrategyID

State

Position

PnL

Risk

Trailing

ConfigVersion
Active Trades
atlas:trade:active

Sorted Set

score

Entry Time
Strategy Trades
atlas:strategy:

EMA

trades

Set

Orders
atlas:order:{orderId}
Broker Mapping
atlas:brokerOrder:

123456

↓

TradeID
Positions
atlas:position:

strategy

symbol
Reports
atlas:report:

daily

20260801
Metrics
atlas:metrics
21. Trade APIs

Trade Manager exposes

OpenTrade()

CloseTrade()

UpdateTrade()

GetTrade()

GetStrategyTrades()

MoveStopLoss()

SyncBroker()

Recover()

Nothing else.

22. Trade Events

Consumes

SignalGenerated

OrderFilled

OrderRejected

OrderCancelled

TrailingMoved

WorkflowCompleted

Publishes

TradeOpened

TradeClosed

PositionUpdated

PnLUpdated

RiskExceeded
23. Failure Handling

Broker down

↓

Retry

Broker reconnect

↓

Resync

Redis down

↓

Fail workflow

Never lose trade state.

24. Sequence Diagram
Strategy

↓

BUY

↓

Trade Manager

↓

Risk

↓

Broker

↓

Order

↓

Filled

↓

Position

↓

Trade OPEN
25. Biggest Improvement I'd Like to Make

Now comes something I haven't mentioned before, and I think it'll make Atlas significantly better.

Introduce a Portfolio Manager

Right now, every strategy is independent.

But suppose you have:

Silver

EMA BUY
Silver

Breakout BUY
Gold

Trend BUY

Margin

₹2,80,000

Available Capital

₹2,00,000

Who decides?

Trade Manager shouldn't.

That's Portfolio Manager's job.

Portfolio Manager
Signals

↓

Capital

↓

Margin

↓

Exposure

↓

Correlation

↓

Allocation

↓

Approved Trades

Responsibilities

Capital

Margin

Sector Exposure

Commodity Exposure

Daily Limits

Overall Risk

Future

Kelly

Risk Parity

Volatility Allocation
New Architecture
Strategy

↓

Signal

↓

Strategy Orchestrator

↓

Portfolio Manager

↓

Trade Manager

↓

Broker

This separation makes the platform much closer to how institutional trading systems are structured.

📍 I think we're now ready for the next major document

At this point we've frozen:

Vision
Requirements
HLD
LLD
Configuration
Workflow
Trade Manager

The next document should be:

10-market-data-indicator-engine.md

This is where we'll answer some of the most important performance questions:

How do we cache candles?
How do we avoid recalculating EMA 20 times?
How do we handle multiple timeframes efficiently?
How do we build 2H and 4H candles from 1H candles?
Can we derive higher timeframes instead of fetching them?
How do we implement incremental EMA/RSI/Supertrend updates?
How do we store only the last N candles in memory?
How do we support future historical replay?

I actually think this document will save us the most CPU and API calls, and it's the one that will make Atlas scale from 3 strategies to 300 strategies without redesigning the core.

we can skip the portfolio management part, i will ensure that i will always have the funds needed for the starategies that i am running, it should be possible to mock/simluate the paper trades without actual cash, if possible without placing orders, as they will be rejected 

I actually agree with skipping the Portfolio Manager for V1. Given your use case, I think it would just add complexity without adding value.

Your use case is very different from a hedge fund:

Only you are trading.
3-10 strategies maximum.
Mostly MCX commodities.
You already know your capital.
You won't deploy 100 strategies simultaneously.

So I'd remove it entirely from V1.

I would change the architecture slightly

Instead of

Strategy
    ↓
Strategy Orchestrator
    ↓
Portfolio Manager
    ↓
Trade Manager
    ↓
Broker

We'll have

Strategy
    ↓
Strategy Orchestrator
    ↓
Trade Manager
    ↓
Broker

Much cleaner.

But I want to make one addition

Instead of

Paper Broker

I think we should call it

Execution Simulator

This is much more powerful.

Three execution modes

Instead of

Paper

Live

We'll support

Execution Mode

↓

LIVE

PAPER

SIMULATION

These are very different.

LIVE

Real broker.

Trade

↓

Flattrade

↓

Real Order
PAPER

This is what Zerodha Streak does.

Trade

↓

Virtual Position

↓

Market Price

↓

PnL

No order.

No broker.

No capital required.

SIMULATION

This is even better.

Instead of placing anything.

We simulate

Signal

↓

Virtual Entry

↓

Virtual SL

↓

Virtual Target

↓

Virtual Trailing

↓

PnL

No broker.

No order.

Nothing.

I actually think Simulation should become V1

Because your biggest requirement was

I don't know whether my strategy is actually profitable.

Simulation solves exactly that.

New Architecture
                   Trade Manager

                        │

         ┌──────────────┼──────────────┐

         ▼              ▼              ▼

      Live         Paper         Simulation

      Broker       Broker        Engine

Notice

Simulation is NOT a broker.

Why?

Because

Broker

means

Order

↓

Exchange

Simulation

means

Trade

↓

Internal State

Completely different.

Simulation Engine

Responsibilities

Entry

↓

SL

↓

Trailing

↓

Exit

↓

PnL

↓

Reports

Nothing else.

No Order IDs

Since

there are no orders.

Trade becomes

Trade

↓

Position

↓

SL

↓

Target

Internally.

During every workflow

Suppose

1H candle closed.

Workflow

↓

Simulation

↓

Current Candle

Simulation checks

High

Low

Close

against

Trade

Example

Trade

BUY

Entry

100000

SL

99500

Target

101500

Next candle

High

101800

Low

99900

Immediately

Target Hit.

Trade Closed.

No broker.

Trailing

Same.

Suppose

BUY

100000

SL

99500

Price

100500

Policy

Move SL to EMA

Simulator

↓

SL

becomes

100250

No API.

Multiple strategies

Suppose

EMA

BUY

Breakout

BUY

Trend

SELL

Simulation stores

three trades.

Trade

Strategy

EMA
Trade

Strategy

Breakout
Trade

Strategy

Trend

Independent.

Exactly like

Trade Manager.

Redis

Instead of

atlas:paper

I'd create

atlas:simulation

Keys

atlas:simulation:trade:{tradeId}
atlas:simulation:active
atlas:simulation:history
atlas:simulation:pnl
Reports

Simulation becomes extremely useful.

Example

EMA Pullback

Trades

54

Wins

39

Losses

15

Win Rate

72%

Profit Factor

2.4

Average Hold

11 Hours

Without risking

₹1.

Replay

Now comes the really exciting part.

Remember we wanted

Backtesting.

We can actually use

Simulation Engine.

Historical

↓

Replay Candles

↓

Workflow

↓

Simulation

Done.

No changes.

Live Migration

Suppose

EMA

is doing really well.

Simply

execution:

    mode: LIVE

Instead of

execution:

    mode: SIMULATION

Nothing else changes.

This solves your biggest concern

You said

I don't think we have proper historical commodity data.

Exactly.

Instead of backtesting,

we'll do

Forward Testing

Example

Today

↓

Strategy Enabled

↓

Simulation

↓

2 Weeks

↓

Reports

↓

Satisfied?

↓

Switch to LIVE

This is actually what many discretionary traders do before trusting a new strategy.

I want to improve this even further

I think we should introduce a Market Replay Engine (Phase 2), but it's worth designing now.

Imagine this:

Market Data Service
        │
        ├── Live Candle Provider
        │
        └── Replay Candle Provider

Everything downstream (Indicators, Features, Strategies, Trade Manager, Simulation) receives candles through the same interface.

That means:

Live Mode → candles come from Flattrade.
Replay Mode → candles come from historical files.
Simulation works identically in both.

So the execution pipeline doesn't know whether it's processing today's 1H candle or a candle from six months ago.

This gives us a huge benefit later:

Replay Engine
      │
      ▼
Workflow Engine
      ▼
Simulation
      ▼
Performance Report

No special "backtesting code" is required. We're simply replaying the market through the exact same engine that runs live.
