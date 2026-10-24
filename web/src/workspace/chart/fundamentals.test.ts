// Result markers and the P/E line: which candle a result belongs to, and what EPS was public when.
import { describe, expect, it } from 'vitest'
import type { EpsPoint, FinancialEvent } from '../api/types'
import { candle, ist } from '../lib/testutil'
import { peOutput, resultMarkers } from './fundamentals'
import { COLORS } from './overlays'

const event = (date: string, over: Partial<FinancialEvent> = {}): FinancialEvent => ({
  date, quarter: 'Jun 2026', net_profit: 10, eps: 1, revenue_growth_pct: 5, profit_growth_pct: 42, reaction_pct: null, ...over,
})
// Mon 3 Aug .. Fri 7 Aug 2026, daily candles open at 09:15 IST
const daily = [3, 4, 5, 6, 7, 10].map((d) => candle(ist(2026, 8, d, 9, 15), 100, 101, 99, 100))

describe('result markers', () => {
  it('sits on the daily candle of the result day', () => {
    const [m] = resultMarkers([event('2026-08-05')], daily, '1D')
    expect(m).toMatchObject({ id: 'result:2026-08-05', time: ist(2026, 8, 5, 9, 15), position: 'belowBar', shape: 'circle' })
  })

  it('on an intraday chart it is the last candle of the day, because results land after the bell', () => {
    const hourly = [9, 10, 11, 12, 13, 14, 15].map((h) => candle(ist(2026, 8, 5, h, 15), 1, 1, 1, 1))
    hourly.push(candle(ist(2026, 8, 6, 9, 15), 1, 1, 1, 1))
    const [m] = resultMarkers([event('2026-08-05')], hourly, '1H')
    expect(m.time).toBe(ist(2026, 8, 5, 15, 15))
  })

  it('a Saturday result goes on the Friday candle', () => {
    const [m] = resultMarkers([event('2026-08-08')], daily, '1D')
    expect(m.time).toBe(ist(2026, 8, 7, 9, 15))
  })

  it('on a weekly chart it is the week that contains the date', () => {
    const weekly = [candle(ist(2026, 7, 27, 9, 15), 1, 1, 1, 1), candle(ist(2026, 8, 3, 9, 15), 1, 1, 1, 1), candle(ist(2026, 8, 10, 9, 15), 1, 1, 1, 1)]
    expect(resultMarkers([event('2026-08-06')], weekly, '1W')[0].time).toBe(ist(2026, 8, 3, 9, 15))
  })

  it('a result in the still-forming week of a weekly chart is kept', () => {
    const weekly = [candle(ist(2026, 8, 3, 9, 15), 1, 1, 1, 1)]
    expect(resultMarkers([event('2026-08-06')], weekly, '1W')).toHaveLength(1)
  })

  it('skips results older than the loaded history', () => {
    const intraday = [candle(ist(2026, 8, 10, 9, 15), 1, 1, 1, 1), candle(ist(2026, 8, 10, 9, 16), 1, 1, 1, 1)]
    expect(resultMarkers([event('2026-07-01'), event('2026-08-10')], intraday, '1m').map((m) => m.id)).toEqual(['result:2026-08-10'])
    expect(resultMarkers([event('2026-02-01')], daily, '1D')).toEqual([])
  })

  it('skips results dated after the last candle', () => {
    expect(resultMarkers([event('2026-08-12')], daily, '1D')).toEqual([])
  })

  it('is green for growing profit, red for falling, grey when unknown', () => {
    const colors = resultMarkers([event('2026-08-04', { profit_growth_pct: 0 }), event('2026-08-05', { profit_growth_pct: -3 }), event('2026-08-06', { profit_growth_pct: null })], daily, '1D').map((m) => m.color)
    expect(colors).toEqual([COLORS.up, COLORS.down, COLORS.neutral])
  })

  it('is a small E under the candle; the numbers live in the Financials panel', () => {
    expect(resultMarkers([event('2026-08-05', { profit_growth_pct: 42, reaction_pct: -3.14 })], daily, '1D')[0].text).toBe('E')
    expect(resultMarkers([event('2026-08-05', { profit_growth_pct: null })], daily, '1D')[0].text).toBe('E')
  })

  it('comes back in time order, as the chart library requires', () => {
    const out = resultMarkers([event('2026-08-06'), event('2026-08-04')], daily, '1D')
    expect(out.map((m) => m.id)).toEqual(['result:2026-08-04', 'result:2026-08-06'])
  })

  it('nothing without candles or events', () => {
    expect(resultMarkers([event('2026-08-05')], [], '1D')).toEqual([])
    expect(resultMarkers([], daily, '1D')).toEqual([])
  })
})

describe('P/E line', () => {
  const eps = (time: number, value: number): EpsPoint => ({ time, value, period: 'Q', estimated: false })

  it('is the close over the EPS that was public at the time', () => {
    const candles = [candle(ist(2026, 8, 5, 9, 15), 0, 0, 0, 100), candle(ist(2026, 8, 6, 9, 15), 0, 0, 0, 100), candle(ist(2026, 8, 7, 9, 15), 0, 0, 0, 100)]
    // 10 until Aug 6 00:00 IST, then 20: the Aug 6 candle already sees the new EPS, Aug 5 does not
    const out = peOutput(candles, [eps(ist(2026, 8, 1), 10), eps(ist(2026, 8, 6), 20)])
    expect(out?.lines[0].points.map((p) => p.value)).toEqual([10, 5, 5])
  })

  it('has no value before the first EPS is public', () => {
    const candles = [candle(ist(2026, 8, 5, 9, 15), 0, 0, 0, 100), candle(ist(2026, 8, 6, 9, 15), 0, 0, 0, 100)]
    expect(peOutput(candles, [eps(ist(2026, 8, 6), 10)])?.lines[0].points).toEqual([{ time: ist(2026, 8, 6, 9, 15), value: 10 }])
  })

  it('leaves a gap while the company is loss-making', () => {
    const candles = [candle(ist(2026, 8, 5, 9, 15), 0, 0, 0, 100), candle(ist(2026, 8, 7, 9, 15), 0, 0, 0, 100)]
    const out = peOutput(candles, [eps(ist(2026, 8, 1), 10), eps(ist(2026, 8, 6), -2)])
    expect(out?.lines[0].points.map((p) => p.time)).toEqual([ist(2026, 8, 5, 9, 15)])
  })

  it('is a separate pane, labelled', () => {
    const out = peOutput([candle(ist(2026, 8, 5, 9, 15), 0, 0, 0, 100)], [eps(ist(2026, 8, 1), 10)])
    expect(out).toMatchObject({ id: 'fund:pe', label: 'P/E (TTM)', pane: 'separate' })
  })

  it('is null when there is nothing to draw', () => {
    const c = [candle(ist(2026, 8, 5, 9, 15), 0, 0, 0, 100)]
    expect(peOutput([], [eps(1, 10)])).toBeNull()
    expect(peOutput(c, [])).toBeNull()
    expect(peOutput(c, [eps(ist(2026, 9, 1), 10)])).toBeNull() // EPS only becomes public after the last candle
    expect(peOutput(c, [eps(1, -5)])).toBeNull()
  })
})
