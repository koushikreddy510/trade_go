import { describe, expect, it } from 'vitest'
import type { Position, Quote } from '../api/types'
import { distanceToExit, livePnl, totalPnl } from './positions'

const pos = (over: Partial<Position> = {}): Position => ({
  id: 'p', source: 'paper', signal_id: null, symbol: 'NSE:SBIN-EQ', side: 'BUY', quantity: 10, entry_price: 100, stop: 95, target: 110, status: 'open',
  opened_at: 0, closed_at: null, exit_price: null, exit_reason: null, realized_pnl: null, ...over,
})
const q = (price: number, symbol = 'NSE:SBIN-EQ'): Quote => ({ symbol, price, ts: 0, prev_close: null, open: null, high: null, low: null, volume: null, change: null, change_pct: null })

describe('live profit and loss', () => {
  it('a long gains when the price rises', () => expect(livePnl(pos(), q(103))).toBe(30))
  it('a short gains when the price falls', () => expect(livePnl(pos({ side: 'SELL' }), q(97))).toBe(30))
  it('is unknown until a price has arrived', () => expect(livePnl(pos())).toBeNull())
  it('falls back to the price the server last reported', () => expect(livePnl(pos({ last_price: 101 }))).toBe(10))
  it('prefers the live quote over the server’s older number', () => expect(livePnl(pos({ last_price: 101 }), q(105))).toBe(50))
})

describe('how close a trade is to its exit', () => {
  it('measures stop and target distance as a percentage of price', () => {
    const d = distanceToExit(pos(), 100)
    expect(d).toEqual({ stopPct: 5, targetPct: 10 })
  })
  it('handles positions with no stop or target, or no price', () => {
    expect(distanceToExit(pos({ stop: null, target: null }), 100)).toEqual({ stopPct: null, targetPct: null })
    expect(distanceToExit(pos(), undefined)).toEqual({ stopPct: null, targetPct: null })
  })
})

describe('total open P&L', () => {
  it('adds up positions that have a price and says how many it could value', () => {
    const quotes = { 'NSE:SBIN-EQ': q(102), 'NSE:TCS-EQ': q(98, 'NSE:TCS-EQ') }
    const out = totalPnl([pos(), pos({ id: 'b', symbol: 'NSE:TCS-EQ', side: 'SELL' }), pos({ id: 'c', symbol: 'NSE:NOPRICE-EQ' })], quotes)
    expect(out).toEqual({ total: 20 + 20, known: 2 })
  })
})
