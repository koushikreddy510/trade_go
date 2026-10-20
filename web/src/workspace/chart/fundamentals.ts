// Fundamentals drawn on the chart: a marker on each result day and a P/E (TTM) line.
// Pure data in, plain specs out, so "is the marker on the right candle?" is testable without a canvas.
import type { Candle, EpsPoint, FinancialEvent, Timeframe } from '../api/types'
import { fmtPct } from '../lib/format'
import { tfSeconds } from '../lib/timeframes'
import { COLORS, type IndicatorOutput, type MarkerSpec } from './overlays'

const IST_OFFSET = 19800
const DAY = 86400
const PE_COLOR = '#ba68c8'

const istDate = (ts: number) => new Date((ts + IST_OFFSET) * 1000).toISOString().slice(0, 10)
/** The last second of an ISO date on the IST clock, as epoch seconds. */
const endOfDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d, 23, 59, 59) / 1000 - IST_OFFSET
}

/** A square above the candle that was current when each result came out, coloured by profit growth.
 *  Results usually land after the bell, so on an intraday chart this is the last candle of that day; at a weekend or
 *  holiday it is the last candle before it (a Friday close for a Saturday result). Dates the loaded candles do not reach
 *  - older than the history, or still in the future - get no marker. */
export function resultMarkers(events: FinancialEvent[], candles: Candle[], tf: Timeframe): MarkerSpec[] {
  if (candles.length === 0) return []
  const lastDay = istDate(candles[candles.length - 1].time + (tf === '1W' ? 6 * DAY : 0)) // a week candle covers its whole week
  const reach = Math.max(tfSeconds(tf), 4 * DAY) // how far back a candle may be and still stand for that date
  const out: MarkerSpec[] = []
  for (const e of events) {
    if (e.date > lastDay) continue
    const eod = endOfDay(e.date)
    let hit: Candle | undefined
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].time <= eod) { hit = candles[i]; break }
    }
    if (!hit || eod - hit.time >= reach) continue
    const growth = e.profit_growth_pct
    const reaction = e.reaction_pct === null ? '' : ` · ${fmtPct(e.reaction_pct, 1)}`
    out.push({
      id: `result:${e.date}`, time: hit.time, position: 'aboveBar', shape: 'square',
      color: growth === null ? COLORS.neutral : growth >= 0 ? COLORS.up : COLORS.down,
      text: `Result${growth === null ? '' : ` PAT ${fmtPct(growth, 0)}`}${reaction}`,
    })
  }
  return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)) // lightweight-charts requires ascending order
}

/** Price / trailing-twelve-month EPS on every candle, using the EPS that was public at that time.
 *  No point while EPS is unknown or not positive (a P/E of a loss-making company is meaningless). */
export function peOutput(candles: Candle[], eps: EpsPoint[]): IndicatorOutput | null {
  if (candles.length === 0 || eps.length === 0) return null
  const points: { time: number; value: number }[] = []
  let k = -1
  for (const c of candles) {
    while (k + 1 < eps.length && eps[k + 1].time <= c.time) k++
    if (k >= 0 && eps[k].value > 0) points.push({ time: c.time, value: c.close / eps[k].value })
  }
  if (points.length === 0) return null
  return { id: 'fund:pe', label: 'P/E (TTM)', pane: 'separate', lines: [{ key: 'pe', kind: 'line', color: PE_COLOR, width: 1, points }] }
}
