# Terminal API — milestone 1

Atlas now exposes a paper-safe terminal API on the same address as `/healthz`
when started with `-serve`. It provides a chart read model and saved drawings;
it cannot place, modify, or cancel orders.

## Chart

`GET /api/v1/chart?timeframe=1H`

The response includes OHLCV candles, registered strategy indicators, active
Atlas-managed positions, and a generation timestamp. Supported timeframes are
`1H`, `2H`, and `4H`.

## Drawings

Drawings are scoped to one user, the configured instrument, and timeframe.
Until authentication is added, omit `user` for the local namespace or supply a
local identifier through `?user=...`.

* `GET /api/v1/drawings?timeframe=1H`
* `PUT /api/v1/drawings?timeframe=1H`
* `DELETE /api/v1/drawings?timeframe=1H&id=my-line`

The `PUT` body accepts `trend_line`, `horizontal_line`, or `channel`; each point
uses Unix seconds and a positive price:

```json
{
  "id": "silver-support",
  "kind": "horizontal_line",
  "points": [{"time": 1788240600, "price": 75000}],
  "color": "#2ecc71",
  "label": "Support"
}
```

When Redis is connected, drawings persist under `atlas:chart:drawing:*`.
Without Redis Atlas uses memory only, so drawings disappear on restart. The API
does not authenticate requests yet and must therefore only be bound to a trusted
network until the frontend authentication milestone is complete.

## Next milestone

The browser client will consume these endpoints with TradingView Lightweight
Charts, render the active-trade stop/target/trailing overlays, and save drawing
interactions through this API. Live broker order actions remain out of scope.
