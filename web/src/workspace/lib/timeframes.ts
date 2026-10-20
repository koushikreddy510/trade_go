// TypeScript twin of trading_service/terminal/timeframes.py (verified against golden.json).
// Bars are cut on the exchange session clock in IST; IST has no daylight saving so a
// fixed +05:30 offset is exact.
import type { Timeframe } from '../api/types'

const IST_OFFSET = 19800 // seconds
const DAY = 86400

type Session = { open: number; close: number } // seconds after local midnight
const EQUITY: Session = { open: 9 * 3600 + 15 * 60, close: 15 * 3600 + 30 * 60 }
const SESSIONS: Record<string, Session> = { NSE: EQUITY, BSE: EQUITY, NFO: EQUITY, BFO: EQUITY, MCX: { open: 9 * 3600, close: 23 * 3600 + 30 * 60 } }

const INTRADAY_MINUTES: Partial<Record<Timeframe, number>> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1H': 60, '2H': 120, '4H': 240 }

export function exchangeOf(symbol: string): string {
  return symbol.includes(':') ? symbol.split(':', 1)[0].toUpperCase() : 'NSE'
}
const sessionOf = (exchange: string): Session => SESSIONS[exchange.toUpperCase()] ?? EQUITY

/** Nominal bar length in seconds (used to extend lines past the last bar). */
export function tfSeconds(tf: Timeframe): number {
  if (tf === '1D') return DAY
  if (tf === '1W') return 7 * DAY
  return (INTRADAY_MINUTES[tf] as number) * 60
}
export const isIntraday = (tf: Timeframe) => tf in INTRADAY_MINUTES

const localDay = (ts: number) => Math.floor((ts + IST_OFFSET) / DAY) // days since 1970-01-01 in IST
const weekday = (day: number) => (day + 3) % 7 // Monday = 0
const at = (day: number, seconds: number) => day * DAY - IST_OFFSET + seconds

export const sessionOpen = (day: number, exchange: string) => at(day, sessionOf(exchange).open)
export const sessionClose = (day: number, exchange: string) => at(day, sessionOf(exchange).close)

export function inSession(ts: number, exchange: string): boolean {
  const day = localDay(ts)
  if (weekday(day) >= 5) return false
  return sessionOpen(day, exchange) <= ts && ts < sessionClose(day, exchange)
}

export function bucketStart(ts: number, tf: Timeframe, exchange: string): number {
  const day = localDay(ts)
  if (tf === '1W') return sessionOpen(day - weekday(day), exchange)
  const open = sessionOpen(day, exchange)
  if (tf === '1D') return open
  const step = INTRADAY_MINUTES[tf] as number
  const elapsedMin = Math.max(0, Math.floor((ts - open) / 60))
  return open + Math.floor(elapsedMin / step) * step * 60
}

export function bucketEnd(start: number, tf: Timeframe, exchange: string): number {
  const day = localDay(start)
  if (tf === '1W') return sessionClose(day + 4 - weekday(day), exchange)
  const close = sessionClose(day, exchange)
  if (tf === '1D') return close
  return Math.min(start + (INTRADAY_MINUTES[tf] as number) * 60, close)
}

export const isComplete = (start: number, tf: Timeframe, now: number, exchange: string) => bucketEnd(start, tf, exchange) <= now

/** IST wall-clock text for a unix time, e.g. "19 Oct 09:15". */
export function formatIst(ts: number, withDate = true): string {
  const d = new Date((ts + IST_OFFSET) * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  return withDate ? `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${time}` : time
}

/** "19 Oct" for axis labels on daily and higher charts. */
export function formatIstDate(ts: number): string {
  return formatIst(ts, true).split(' ').slice(0, 2).join(' ')
}
