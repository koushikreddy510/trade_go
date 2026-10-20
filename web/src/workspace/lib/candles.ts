// Keeping the chart's candles in step with the live feed.
//
// The server streams ticks (conflated to ~4 per second per symbol) and announces each
// finished bar. Between those, the newest candle is "forming": we fold ticks into it
// here so the chart moves with the price. When the server reports the bar closed, its
// authoritative OHLCV replaces our approximation (e.g. it carries the true volume).
import type { Candle, Timeframe } from '../api/types'
import { bucketStart, exchangeOf, inSession, isComplete } from './timeframes'

/** Fold one price into the candle list. Returns the SAME array when nothing changes. */
export function applyTick(candles: Candle[], symbol: string, tf: Timeframe, price: number, ts: number): Candle[] {
  const exchange = exchangeOf(symbol)
  if (!inSession(ts, exchange)) return candles // pre-open / post-close prints never make candles
  const start = bucketStart(ts, tf, exchange)
  const last = candles[candles.length - 1]
  if (!last) return candles
  if (start < last.time) return candles // a late tick for a bar that is already behind us
  if (start === last.time) {
    if (price === last.close && price <= last.high && price >= last.low) return candles
    const bar: Candle = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
    return [...candles.slice(0, -1), bar]
  }
  return [...candles, { time: start, open: price, high: price, low: price, close: price, volume: 0 }]
}

/** Replace (or append) a bar the server says is final. */
export function applyClosedBar(candles: Candle[], bar: Candle): Candle[] {
  const i = candles.findIndex((c) => c.time === bar.time)
  if (i >= 0) return [...candles.slice(0, i), bar, ...candles.slice(i + 1)]
  const last = candles[candles.length - 1]
  if (!last || bar.time > last.time) return [...candles, bar]
  return [...candles, bar].sort((a, b) => a.time - b.time)
}

/** True while the newest candle is still being built. */
export function isForming(candles: Candle[], symbol: string, tf: Timeframe, now: number): boolean {
  const last = candles[candles.length - 1]
  return !!last && !isComplete(last.time, tf, now, exchangeOf(symbol))
}
