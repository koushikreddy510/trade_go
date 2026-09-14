# Atlas — Implementation Decisions (Frozen)

Last updated: 2026-08-01

## Locked decisions

| # | Decision |
|---|----------|
| Architecture | **Processor pipeline** (`Process(ctx *ExecutionContext)`) + plugins. Classic Go-channel **event bus** only for cross-cutting concerns (logging hooks, metrics, broker WS fan-in). |
| Language | Go **1.25+** (local: 1.25.4) |
| Module path | `github.com/koushik-bangaru/atlas` |
| Runtime shape | **Single binary** (`cmd/atlas`), not microservices |
| Local/dev | Docker Compose: `atlas` + Redis |
| Prod | Any Linux VM (Hetzner, Oracle, etc.) + same Compose stack + static IP for Flattrade |
| Portfolio Manager | **Skipped** — operator ensures capital |
| Conflict policy | Multiple strategies may hold independent trades on the same symbol |
| V1 execution mode | **Simulation** first (no broker orders). Paper + Live later via same Trade Manager interfaces |
| Strategy (V1) | Dual Supertrend (lower + higher range) + EMA. **No pullback feature** for now |
| Timeframes | 1H, 2H, 4H (multi-TF strategies allowed, e.g. 1H entry + 2H filter). 4H is **derived** from lower TF — Flattrade `TPSeries` max `intrv` is `120` |
| Market data | Real Flattrade client (`TPSeries`, quotes, auth). Fixtures/mocks for offline unit tests |
| Broker live | Flattrade Pi API v2 — deferred until Simulation proves strategies |

## Flattrade API v2 — static IP (important)

Source: [Pi docs](https://pi.flattrade.in/docs), [API v2 launch](https://flattrade.in/kosh/flattrade-api-implementation-of-retail-algo-standards-api-version-2-launch/), [IP rejection FAQ](https://flattrade.in/support/knowledge-base/why-are-my-api-orders-getting-rejected-due-to-invalid-ip-address/)

- Creating an API key **requires** a primary static IP (secondary optional).
- Access-token exchange (`authapi.flattrade.in/trade/apitoken`) only succeeds from the **registered static IP**.
- Orders must originate from the **same IP** used to generate the token (primary↔primary or secondary↔secondary).
- Static IP can be changed **once per calendar week**.
- Non-registered algo key: &lt; 10 orders/sec. Commodity: LMT / SL-LMT only; no IOC on commodity.
- Base URL: `https://piconnect.flattrade.in/PiConnectAPI`
- Candles: `POST /TPSeries` — `intrv`: `1|3|5|10|15|30|60|120` (no 240 → we aggregate 4H).

### Practical local vs prod

| Mode | Needs Flattrade static IP? |
|------|----------------------------|
| Simulation + fixture candles | No |
| Simulation + live candles | Yes (token + market data from registered IP) |
| Live orders | Yes (token + orders from registered IP) |

Recommended: cheap VPS with a fixed public IP → register that IP in Wall → run Atlas Docker there for anything that talks to Flattrade. Laptop Compose stays fine for Simulation/fixtures.

## Phase plan

### Phase 0 — Bootstrap (now)
Go module, folder layout, Makefile, Dockerfile, docker-compose (Redis + atlas), logging, lint, docs move, sample config.

### Phase 1 — Core
Domain types, event bus, config (YAML → compiled), ExecutionContext, processor interface, Redis repo skeleton.

### Phase 2 — Market + indicators ✅
Flattrade client + MarketProvider, Market Data service (fixture offline / Flattrade live), candle cache, TF aggregation (2H/4H), EMA / RSI / Supertrend (incremental).

### Phase 3 — Strategy ✅
Dual Supertrend + EMA strategy plugin, multi-TF config fields, Strategy Orchestrator (collect signals; no capital allocation).

### Phase 4 — Execution ✅
Workflow engine, Trade Manager (in-memory), Simulation engine (SL/target), cross-module integration tests (no Redis required).

### Phase 5 — Deploy-ready ✅
PAPER/LIVE wiring (Flattrade market data + brokers), `live_orders` safety gate, healthz, session token job, VM deploy pack (`docs/vm-deploy.md`, systemd, `docker-compose.vm.yml`, `scripts/deploy-vm.sh`).

Recommended first VM test: **PAPER** (live candles, paper fills). Enable LIVE only with `live_orders: true` after stable PAPER.

### Phase 6 — Reporting ✅
Deterministic simulation performance report (`-report`) with realized/unrealized PnL, win rate, open/closed counts, and per-strategy aggregates.

Still optional later: WebSocket fill updates, a browser reporting UI, DynamoDB if you keep AWS Lambda for auth.

## Deployment model

**One deploy unit.** Packages (`internal/*`, `plugins/*`) are libraries inside a **single `atlas` binary**. Docker Compose runs `atlas` + `Redis` together — not one container per package. Same image for local, Hetzner, or any VM.

## Processor pipeline (V1)

```
Scheduler → Workflow → ExecutionContext
  → MarketProcessor
  → IndicatorProcessor
  → StrategyProcessor      # dual ST + EMA
  → TradeProcessor
  → SimulationProcessor    # or Live later
  → ReportingProcessor
```

## Repo layout

```
atlas/
  cmd/atlas/
  internal/
    engine/ workflow/ scheduler/ context/
    trade/ events/ config/ repository/ logging/
  plugins/
    broker/flattrade/ broker/paper/
    indicators/{ema,rsi,supertrend}/
    strategies/dual_supertrend_ema/
    trailing/
  configs/ deployments/ docs/ scripts/ test/
```

## Strategy sketch (V1)

Working name: `dual_supertrend_ema`

- Supertrend **lower** range (tighter ATR/multiplier) — entry / early trend
- Supertrend **higher** range (wider) — regime / filter
- EMA — bias / trail reference
- Multi-TF: e.g. higher TF ST alignment + lower TF entry (exact params in YAML)
