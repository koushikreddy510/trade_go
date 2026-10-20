# Flattrade Pi API v2 — Atlas Reference

Atlas market data and (later) live execution use [Flattrade Pi API v2](https://pi.flattrade.in/docs).

| Item | Value |
|------|-------|
| REST base URL | `https://piconnect.flattrade.in/PiConnectAPI` |
| Auth URL | `https://authapi.flattrade.in/trade/apitoken` |
| Browser OAuth | `https://auth.flattrade.in/?app_key={API_KEY}` |
| Session token | `jKey` — valid ~24h, cleared **5–6 AM IST** daily |

Official docs: [pi.flattrade.in/docs](https://pi.flattrade.in/docs)

---

## API key vs daily jKey (important)

Flattrade uses **two different credentials** — do not confuse them.

| Credential | Created when | Expires | Used for |
|------------|--------------|---------|----------|
| **API key** + **API secret** | Once in Flattrade Wall (with static IP) | Never (until revoked in Wall) | Browser OAuth URL; hashing for `ExchangeToken` |
| **jKey** (session / access token) | Daily via browser OAuth + `ExchangeToken` | Cleared **5–6 AM IST** each trading day | Every PiConnect REST call (`jData` + `jKey`) |

**Atlas storage**

- API key + secret: config / env (`FLATTRADE_API_KEY`, `FLATTRADE_API_SECRET`) — long-lived.
- jKey: Redis key `atlas:broker:flattrade:token` with TTL until next **5:30 AM IST** — refreshed daily on the Oracle VM.

**Daily operator flow (Oracle VM)**

1. Ensure VM public IP matches Flattrade Wall registered IP.
2. Prefer the **scheduled job** (below) or:
3. `make auth-url` → open URL in browser, log in.
4. Either:
   - `make listen-auth` (redirect URL `http://VM_IP:8080/callback` registered in Wall), or
   - Copy `request_code` from redirect and run `./bin/atlas -exchange-token CODE`.
5. Start Atlas (`-serve` / `-once`) — app loads jKey from Redis into `flattrade.Client`.

### Daily session-token job (EventBridge → Lambda equivalent)

Previously you may have used **EventBridge → Lambda → DynamoDB**. Atlas maps that to:

| Old (AWS) | Atlas (Oracle / VM) |
|-----------|---------------------|
| EventBridge cron before market | Scheduler `JobSessionToken` at `session_token_job.hour_ist` **or** cron calling `scripts/daily-session-token.sh` |
| Lambda | `./bin/atlas -token-job` / job handler inside `-serve` |
| DynamoDB | Redis `atlas:broker:flattrade:token` |

Config (`session_token_job` in YAML):

| Mode | Behavior |
|------|----------|
| `check` | Validate existing Redis jKey via `UserDetails`. Fail loudly if missing (alert via cron exit code). |
| `listen` | Open callback on `:8080` for N minutes; you open the auth URL once; token stored automatically. |
| `file` | Read `request_code` from a file written by external automation, exchange, delete file. |

```bash
# one-shot (cron / systemd timer at 08:15 IST)
make token-job
# or
./scripts/daily-session-token.sh

# crontab example on the VM:
# TZ=Asia/Kolkata
# 15 8 * * 1-5 /opt/atlas/scripts/daily-session-token.sh >> /var/log/atlas-token.log 2>&1
```

When Atlas runs with `-serve`, the same job is also scheduled internally every day at the configured IST time.

**Limitation:** Flattrade Pi v2 still requires a **browser login** to mint `request_code`. The job automates schedule + exchange + Redis storage (what Lambda/Dynamo did). Fully headless credential login is not in the official API — if your old Lambda used Selenium/TOTP, tell us and we can plug that into `mode: file` or a custom provider.

SIMULATION with fixtures does **not** need a jKey.

---

## MCX futures contract selection (SILVERMIC)

Atlas ports the old Lambda logic (`SearchScrip` → filter `FUTCOM` → `get_next_x_fut`):

1. `SearchScrip` with `search_text` (e.g. `SILVERMIC`)
2. Keep `instname=FUTCOM` rows
3. Match tsym `^ROOT YY MON DD` for the chosen month (e.g. `SILVERMIC26SEP30`)
4. If that month is missing, walk forward month-by-month (same as the old `while` loop)

**Policies** (`simulation.month_policy`):

| Policy | Behavior |
|--------|----------|
| `fixed` (default) | Always `month_offset` ahead (default **2** = current + 2 months) |
| `smart` | Day 1–10 → +1 month; last `near_expiry_days` of month → +2; else +1 |

See `configs/atlas.paper.yaml` and package `internal/instruments`.

---

## Authentication flow

Flattrade uses browser OAuth plus a one-time server-side token exchange. Every Pi REST call (except the exchange itself) sends `jData` + `jKey`.

### Steps

1. **Register API key** in Flattrade Wall with redirect URL and **static IP(s)** (primary required; secondary optional).
2. **Browser login** — open:
   ```
   https://auth.flattrade.in/?app_key={API_KEY}
   ```
   Authenticate with client ID (UCC), password, and PAN/DOB.
3. **Capture `request_code`** — redirect lands at your registered URL:
   ```
   https://your-redirect.example/?request_code={REQUEST_CODE}
   ```
   Short-lived (minutes); exchange immediately.
4. **Exchange for `jKey`** — `POST https://authapi.flattrade.in/trade/apitoken` with JSON body:
   ```json
   {
     "api_key": "{API_KEY}",
     "request_code": "{REQUEST_CODE}",
     "api_secret": "{SHA256_HEX}"
   }
   ```
   Where:
   ```
   api_secret = SHA256( api_key + request_code + raw_api_secret )
   ```
   (Concatenate strings; hash the UTF-8 bytes; send lowercase hex.)
5. **Success response**:
   ```json
   {
     "token": "...",
     "client": "CCODE123",
     "status": "Ok",
     "emsg": ""
   }
   ```
   Store `token` as `jKey` for all PiConnect calls.

### Token lifecycle

- Valid for roughly **24 hours** per trading day.
- Sessions are **cleared between 5–6 AM IST** — regenerate after 6 AM IST.
- Atlas should persist `jKey` in Redis (`atlas:broker:flattrade:token`) and refresh via the same flow.

---

## Static IP constraints (API v2 / SEBI retail algo)

API v2 enforces registered static IPs. See [API v2 launch](https://flattrade.in/kosh/flattrade-api-implementation-of-retail-algo-standards-api-version-2-launch/) and [IP rejection FAQ](https://flattrade.in/support/knowledge-base/why-are-my-api-orders-getting-rejected-due-to-invalid-ip-address/).

| Requirement | Detail |
|-------------|--------|
| API key creation | Primary static IP required at registration |
| Token exchange | `POST /trade/apitoken` **only succeeds from registered IP** |
| Orders (later) | Must originate from the **same** IP used for token (primary↔primary or secondary↔secondary) |
| IP changes | Allowed **once per calendar week** |
| Non-registered algo key | &lt; 10 orders/sec; commodity: LMT / SL-LMT only; no IOC on commodity |

**Atlas V1 market data** (`TPSeries`, `SearchScrip`, `GetQuotes`) also requires a valid `jKey`, so token exchange must run from the registered IP even in simulation-with-live-candles mode.

### Oracle Cloud static IP checklist

Use this when deploying Atlas on an Oracle Cloud Always Free VM (or any VPS with a reserved public IP).

| Step | Action |
|------|--------|
| 1 | Create VM with **reserved / elastic public IP** (not ephemeral) |
| 2 | Note the public IP — it must match Wall **primary static IP** |
| 3 | Open inbound **8080** (or your `-auth-port`) for OAuth callback during daily token refresh |
| 4 | In Flattrade Wall: register API key with redirect URL `http://PUBLIC_IP:8080/callback` |
| 5 | Set `flattrade.redirect_url` in config to the same URL (documentation helper) |
| 6 | Run token exchange **from the VM** (`make listen-auth` or `-exchange-token`) — not from laptop |
| 7 | Verify Redis has key `atlas:broker:flattrade:token` before starting `-serve` |

---

## Request encoding (PiConnect REST)

All Atlas V1 endpoints use **POST** with `application/x-www-form-urlencoded` body:

```
jData={"uid":"...","exch":"MCX",...}&jKey={SESSION_TOKEN}
```

- `jData` — JSON object (compact, no extra spaces required).
- `jKey` — session token from step 4 above.

Path is appended to base URL, e.g. `POST {BaseURL}/TPSeries`.

---

## Endpoints used by Atlas V1

### `POST /TPSeries` — intraday candles

**jData fields**

| Field | Required | Description |
|-------|----------|-------------|
| `uid` | yes | Logged-in user ID |
| `exch` | yes | Exchange (e.g. `MCX`, `NSE`) |
| `token` | yes | Instrument token from `SearchScrip` |
| `st` | no | Start time — Unix seconds |
| `et` | no | End time — Unix seconds |
| `intrv` | no | Interval minutes (see below) |

**Allowed `intrv` values:** `1`, `3`, `5`, `10`, `15`, `30`, `60`, `120` — **no `240`**.

**Success candle fields** (array of objects):

| Field | Meaning |
|-------|---------|
| `time` | Bar timestamp (`DD-MM-YYYY HH:MM:SS`) |
| `into` | Open |
| `inth` | High |
| `intl` | Low |
| `intc` | Close |
| `intv` | Interval volume |
| `v` | Cumulative volume |
| `oi` | Open interest |

Docs also expose `intvwap`, `intoi`; Atlas V1 uses OHLCV + OI.

### `POST /SearchScrip` — resolve tokens

| Field | Required | Description |
|-------|----------|-------------|
| `uid` | yes | User ID |
| `stext` | yes | Search text (symbol / partial) |
| `exch` | no | Exchange filter |

**Response `values[]`:** `exch`, `tsym`, `token`, `pp`, `ti`, `ls`.

### `POST /GetQuotes` — LTP and quote snapshot

| Field | Required | Description |
|-------|----------|-------------|
| `uid` | yes | User ID |
| `exch` | yes | Exchange |
| `token` | yes | Instrument token |

Key fields for Atlas: `lp` (last price), `h`, `l`, `v`, `oi`, `request_time`.

### WebSocket — real-time quotes and order events

Flattrade uses one authenticated WebSocket for both touchline market updates and
order/trade updates:

| Item | Value |
|------|-------|
| Endpoint | `wss://piconnect.flattrade.in/PiConnectWSAPI/` |
| Authentication message | `{"t":"a","uid":"…","actid":"…","accesstoken":"<jKey>","source":"API"}` |
| Successful authentication | `t=ck` or `t=ak`, `s=OK` |
| Subscribe touchline | `{"t":"t","k":"MCX|token#NSE|token"}` |
| Subscribe order updates | `{"t":"o","actid":"…"}` |
| Heartbeat | `{"t":"h"}` |

The official SDK describes an initial `tk` touchline snapshot, followed by
sparse `tf` updates containing only changed fields. Atlas must merge each `tf`
with its latest `tk` state; treating a delta as a full quote would erase LTP,
volume, or instrument metadata. `om` messages are order events, including the
broker order ID, status, report type, filled quantity, average/fill price,
rejection details, trigger price, and broker timestamp.

The `plugins/broker/flattrade.Stream` implementation provides this protocol
layer and reconnects with capped exponential backoff. It does **not** start a
connection automatically, place an order, or mutate an account. A subsequent
opt-in runtime integration will use it to feed the quote cache, intraday candle
builder, P&L marks, order reconciliation, and browser event stream.

Reference: [Flattrade's official Python SDK WebSocket section](https://github.com/flattrade/pythonAPI#start_websocket).

---

## Atlas timeframe mapping

| Atlas TF | Flattrade `intrv` | Notes |
|----------|-------------------|-------|
| 1H | `60` | Direct `TPSeries` |
| 2H | `120` | Direct `TPSeries` (max native interval) |
| 4H | — | **Not available** — aggregate **two** consecutive 1H (`intrv=60`) bars in the market-data layer |

Aggregation rules (implemented outside this client):

- Align buckets to exchange session boundaries.
- OHLC: first open, max high, min low, last close.
- Volume / OI: sum or last value per Atlas candle model.

---

## Rate limits

From Pi docs §11–12:

| Scope | Per second | Per minute |
|-------|------------|------------|
| Order APIs | 10 | 40 |
| All other APIs | 40 | 200 |

**Atlas guidance**

- Batch `GetQuotes` where possible; cache candles in Redis.
- Back off on `Not_Ok` / throttle errors; avoid tight loops on `TPSeries` backfill.
- Simulation with fixtures: **no** Flattrade calls — zero rate-limit surface.

---

## Local / dev vs VPS

| Mode | Static IP needed? | Flattrade usage |
|------|-------------------|-----------------|
| Simulation + fixture candles | No | Mock client only |
| Simulation + live candles | **Yes** | Token + `TPSeries` / quotes from VPS IP |
| Live orders (later) | **Yes** | Token + orders from same registered IP |

**Recommended layout**

```
Laptop (dev)          →  docker compose: atlas + redis, fixture data
VPS (fixed public IP) →  register IP in Wall; run atlas for live token + market data
```

- Do not expect token exchange to work from a residential or rotating IP.
- Use separate API keys if prod and test redirect URLs differ.
- Point Atlas `plugins/broker/flattrade` config at `BaseURL` and store `jKey` after exchange on the VPS.

---

## Go client

Package: `github.com/koushik-bangaru/atlas/plugins/broker/flattrade`

- `BrowserAuthURL` — OAuth browser login URL.
- `SessionManager` — load / exchange / store jKey in Redis (`Load`, `ExchangeAndStore`, `DefaultTokenTTL`).
- `ExchangeToken` — JSON POST to auth URL (no `jKey`).
- `TPSeries`, `SearchScrip`, `GetQuotes` — form-encoded PiConnect calls; return `ErrNotConfigured` when `jKey` is empty.
- `HashAPISecret` — SHA-256 helper for token exchange.
- `EncodePiConnectForm` — testable form body builder.

CLI (`cmd/atlas`):

- `-auth-url` — print browser OAuth URL.
- `-exchange-token CODE` — exchange `request_code` and store in Redis (Redis required).
- `-listen-auth` / `-auth-port` — callback HTTP server for OAuth redirect.

Order placement (`PlaceOrder`, etc.) is intentionally **not** implemented in V1.

---

## References

- [Pi API documentation](https://pi.flattrade.in/docs)
- [Flattrade pythonAPI](https://github.com/flattrade/pythonAPI) — request/response examples
- [IMPLEMENTATION.md](../IMPLEMENTATION.md) — frozen Atlas decisions
