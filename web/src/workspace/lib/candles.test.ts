// How the forming candle follows the live price, and when the server's version takes over.
import { describe, expect, it } from 'vitest'
import { applyClosedBar, applyTick, isForming } from './candles'
import { candle, ist } from './testutil'

const SYM = 'NSE:SBIN-EQ'
const H1 = ist(2026, 10, 19, 9, 15) // 1H bar 09:15-10:15
const bars = [candle(ist(2026, 10, 16, 15, 15), 99, 101, 98, 100), candle(H1, 100, 102, 99, 101)]

describe('applyTick', () => {
  it('moves the close and widens the range of the forming bar', () => {
    const next = applyTick(bars, SYM, '1H', 103.5, ist(2026, 10, 19, 9, 40))
    expect(next[1]).toEqual({ ...bars[1], high: 103.5, close: 103.5 })
    const lower = applyTick(next, SYM, '1H', 97, ist(2026, 10, 19, 9, 50))
    expect(lower[1]).toMatchObject({ open: 100, high: 103.5, low: 97, close: 97 })
  })

  it('does not touch earlier bars or mutate the input', () => {
    const before = JSON.stringify(bars)
    const next = applyTick(bars, SYM, '1H', 105, ist(2026, 10, 19, 9, 40))
    expect(next[0]).toBe(bars[0])
    expect(JSON.stringify(bars)).toBe(before)
  })

  it('starts a new candle when the price arrives in the next bucket, opening at that price', () => {
    const next = applyTick(bars, SYM, '1H', 104, ist(2026, 10, 19, 10, 15, 1))
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual({ time: ist(2026, 10, 19, 10, 15), open: 104, high: 104, low: 104, close: 104, volume: 0 })
  })

  it('uses the right bucket for each timeframe', () => {
    const five = [candle(ist(2026, 10, 19, 9, 15), 100, 100, 100, 100)]
    expect(applyTick(five, SYM, '5m', 101, ist(2026, 10, 19, 9, 21))[1].time).toBe(ist(2026, 10, 19, 9, 20))
    const daily = [candle(ist(2026, 10, 19, 9, 15), 100, 100, 100, 100)]
    expect(applyTick(daily, SYM, '1D', 101, ist(2026, 10, 19, 14, 0))).toHaveLength(1)
  })

  it('returns the same array when nothing changed, so the chart is not redrawn', () => {
    const same = applyTick(bars, SYM, '1H', 101, ist(2026, 10, 19, 9, 40))
    expect(same).toBe(bars)
  })

  it('ignores a late tick that belongs to a bar we have already passed', () => {
    expect(applyTick(bars, SYM, '1H', 50, ist(2026, 10, 16, 15, 20))).toBe(bars)
  })

  it('ignores prices outside the trading session', () => {
    expect(applyTick(bars, SYM, '1H', 120, ist(2026, 10, 19, 8, 0))).toBe(bars)
    expect(applyTick(bars, SYM, '1H', 120, ist(2026, 10, 17, 11, 0))).toBe(bars) // Saturday
  })

  it('does nothing before any candles have loaded', () => {
    expect(applyTick([], SYM, '1H', 100, ist(2026, 10, 19, 10, 0))).toEqual([])
  })
})

describe('applyClosedBar', () => {
  it('replaces our approximation of the bar with the server’s final numbers', () => {
    const forming = applyTick(bars, SYM, '1H', 103, ist(2026, 10, 19, 10, 14))
    const final = candle(H1, 100, 104, 99, 103.2, 123456)
    const next = applyClosedBar(forming, final)
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual(final)
  })

  it('appends a bar we had not seen', () => {
    const later = candle(ist(2026, 10, 19, 10, 15), 101, 105, 100, 104)
    expect(applyClosedBar(bars, later).map((c) => c.time)).toEqual([bars[0].time, H1, later.time])
  })

  it('keeps bars in time order when an older bar arrives late', () => {
    const missing = candle(ist(2026, 10, 16, 14, 15), 98, 99, 97, 98)
    expect(applyClosedBar(bars, missing).map((c) => c.time)).toEqual([missing.time, bars[0].time, H1])
  })
})

describe('isForming', () => {
  it('is true until the bar’s hour has passed', () => {
    expect(isForming(bars, SYM, '1H', ist(2026, 10, 19, 10, 14, 59))).toBe(true)
    expect(isForming(bars, SYM, '1H', ist(2026, 10, 19, 10, 15, 0))).toBe(false)
  })
  it('is false with no candles', () => {
    expect(isForming([], SYM, '1H', 0)).toBe(false)
  })
})
