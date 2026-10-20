# Workspace (chart · watchlists · screener · strategies · rules · live positions)

> Whole-system picture and file map: `trading-service/docs/ARCHITECTURE_AND_PROGRESS.md`. Live-data behaviour: `trading-service/docs/LIVE_DATA.md`.

The default screen of `trade/web`. The original MCX-silver terminal is untouched and still
available at `?view=atlas`.

Server side: `trading-service/trading_service/terminal` (see its README for the data flow,
env vars and the once-a-day screener scan).

## Run

```bash
# 1. backend (demo mode needs no broker)
cd trading-service
TERMINAL_MODE=demo DATABASE_URL=postgresql+psycopg2://... uvicorn main:app --port 8001

# 2. web
cd trade/web
npm install
npm run dev          # http://localhost:5173  — /terminal (REST + websocket) is proxied to :8001
npm test             # 303 tests
```

## What you can do

* **Chart**: candles + volume, 1m–1W, on the IST session clock. Add several indicators (EMA, SMA,
  Bollinger on the price; RSI, MACD, ATR in their own panes; Supertrend).
* **Trendlines**: pick *Trend line*, *Ray* or *Level* and click on the chart. Select a line and
  press-and-drag it or its handles; `Delete` removes it, `Esc` returns to the cursor. Lines are
  saved per symbol on the server and extend to the right, exactly as the rule engine reads them.
* **Entry rules**: from a line ("Enter when close crosses above/below") or the *Rules* tab. Build
  conditions from price, indicators, lines and levels, combine with AND/OR, choose a stop (signal
  candle, ATR multiple, %, fixed, or a drawn line) and a target (R-multiple, %, fixed). Rules act
  **only on completed candles**; entries are paper positions.
* **Stops and entries on the chart**: every open position draws its entry, SL (red) and TP (green)
  lines with live P&L; signals appear as arrows on the candle that triggered them.
* **Watchlists**: several lists, symbol search (data-store `symbols`), drag to reorder, live prices
  over the websocket.
* **Positions / Signals / Rules / Financials / Drawings** in the bottom dock. *Financials* shows
  quarterly and annual figures, key ratios and the announced results date from the screener.in /
  NSE data, or says plainly when a symbol has none.
* **Screener** (daily-candle based): preset screens or a custom filter builder over the latest scan;
  sort columns, send results to a watchlist, open the chart. **Strategies**: run a strategy from the
  separate strategy-screener and put the stocks that qualify — plus near-misses within a tolerance you
  choose, optionally gated by quarterly / yearly financials — on a managed watchlist. **Results**:
  companies that reported recently.

## Code map

```
api/        types.ts (server shapes) · client.ts (REST) · socket.ts (reconnecting websocket)
lib/        pure logic: timeframes, indicators, lines, candles, rules, positions, format
store/      store.ts (tiny observable) · state.ts · controller.ts (all behaviour lives here)
chart/      overlays.ts (what to draw, as data) · ChartView.ts (lightweight-charts) · DrawingsPrimitive.ts
components/ small React components that read the store and call the controller
views/      Screener, Strategies and Results
```

Components are deliberately thin: they read the store and call a `Controller` method. That is why
most behaviour is tested without a browser.

## Tests as documentation

Each test name is a sentence about behaviour; start with:

| File | Describes |
|---|---|
| `store/controller.test.ts` | What loads at start-up, what each live message changes, what each action sends |
| `chart/overlays.test.ts` | Where entry / SL / TP lines, signal arrows and indicator lines go |
| `components/ChartPane.test.tsx` | What the chart is told when positions, signals, lines and indicators change |
| `components/RuleDialog.test.tsx` | Building a rule: preview sentence, validation, exactly what is saved |
| `components/PositionsPanel.test.tsx` | Live P&L follows ticks; closing a position |
| `components/FinancialsPanel.test.tsx` | The financial table, ratios, empty state |
| `views/ScreenerView.test.tsx` | Presets, custom filters, sorting, daily scan |
| `views/StrategiesView.test.tsx` | Pick a strategy-screener strategy, tolerance and financial filters; preview matched + near-miss stocks; sync, refresh, unlink |
| `Workspace.test.tsx` | The whole screen against a fake server |
| `lib/golden.test.ts` | TS indicators / timeframes / lines match Python (golden vectors) |
| `api/socket.test.ts` | Subscribing, reconnecting, resubscribing |
| `store/controller.test.ts` (reconnect block) | After the socket drops and returns, the chart, signals and positions are re-read |

The chart itself needs a real canvas, so jsdom tests use a recording fake `ChartView` and check
*what the chart is told*; the drawing maths is covered by `overlays`/`golden` tests, and the real
rendering was checked in a browser against the demo backend.
