// The line of numbers at the top-left of the chart: OHLC, change and every indicator's value for the candle under
// the crosshair (the newest candle when the mouse is elsewhere). Plain data in, plain rows out.
import type { Candle } from '../api/types'
import { fmtPct, fmtPrice, fmtVolume } from '../lib/format'
import { COLORS, type IndicatorOutput } from './overlays'

export type Legend = {
  time: number
  open: string; high: string; low: string; close: string; volume: string
  change: string
  tone: 'up' | 'down'
  indicators: { id: string; label: string; values: { key: string; text: string; color: string }[] }[]
}

/** Index of the candle whose open time is `time`; -1 when there is none. */
function find<T extends { time: number }>(rows: T[], time: number): number {
  let lo = 0
  let hi = rows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].time === time) return mid
    if (rows[mid].time < time) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

export function legendAt(candles: Candle[], outputs: IndicatorOutput[], time: number | null): Legend | null {
  if (candles.length === 0) return null
  let i = time === null ? -1 : find(candles, time)
  if (i < 0) i = candles.length - 1 // the pointer is off the candles (or not on the chart): show the newest
  const c = candles[i]
  const prev = i > 0 ? candles[i - 1].close : c.open // the first candle has nothing before it
  const change = c.close - prev
  return {
    time: c.time,
    open: fmtPrice(c.open), high: fmtPrice(c.high), low: fmtPrice(c.low), close: fmtPrice(c.close), volume: fmtVolume(c.volume),
    change: `${change > 0 ? '+' : ''}${fmtPrice(change)} (${fmtPct(prev ? (change / prev) * 100 : null)})`,
    tone: change >= 0 ? 'up' : 'down',
    indicators: outputs.map((o) => ({
      id: o.id,
      label: o.label,
      values: o.lines.flatMap((l) => {
        const k = find(l.points, c.time)
        if (k < 0) return [] // not defined yet (warm-up) or a gap
        const p = l.points[k]
        return [{ key: l.key, text: fmtPrice(p.value), color: p.color ?? (l.kind === 'histogram' ? COLORS.neutral : l.color) }]
      }),
    })),
  }
}
