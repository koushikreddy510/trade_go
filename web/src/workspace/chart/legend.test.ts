// The numbers shown at the top-left of the chart for the candle under the crosshair.
import { describe, expect, it } from 'vitest'
import { candle, ist } from '../lib/testutil'
import { legendAt } from './legend'
import { COLORS, type IndicatorOutput } from './overlays'

const T = [0, 1, 2].map((i) => ist(2026, 5, 4, 9 + i, 15))
const candles = [candle(T[0], 100, 102, 99, 101, 1500), candle(T[1], 101, 105, 100, 104, 250000), candle(T[2], 104, 104, 96, 98, 90)]
const ema: IndicatorOutput = { id: 'ema-20', label: 'EMA 20', pane: 'price', lines: [{ key: 'value', kind: 'line', color: '#f5a623', width: 1, points: [{ time: T[1], value: 100.5 }, { time: T[2], value: 101.25 }] }] }

describe('legendAt', () => {
  it('is nothing before any candle has loaded', () => {
    expect(legendAt([], [], null)).toBeNull()
  })

  it('shows OHLC, volume and the change from the previous close for the hovered candle', () => {
    expect(legendAt(candles, [], T[1])).toMatchObject({
      time: T[1], open: '101.00', high: '105.00', low: '100.00', close: '104.00', volume: '2.50L', change: '+3.00 (+2.97%)', tone: 'up',
    })
  })

  it('shows a fall in red with its sign', () => {
    expect(legendAt(candles, [], T[2])).toMatchObject({ change: '-6.00 (-5.77%)', tone: 'down' })
  })

  it('has no previous close for the first candle, so measures it against its own open', () => {
    expect(legendAt(candles, [], T[0])).toMatchObject({ change: '+1.00 (+1.00%)', tone: 'up' })
  })

  it('falls back to the newest candle when the pointer is off the candles or off the chart', () => {
    expect(legendAt(candles, [], null)?.time).toBe(T[2])
    expect(legendAt(candles, [], T[2] + 7200)?.time).toBe(T[2])
    expect(legendAt(candles, [], T[0] + 60)?.time).toBe(T[2]) // between two candles' open times
  })

  describe('indicators', () => {
    it('lists each indicator’s value on that same candle', () => {
      const [e] = legendAt(candles, [ema], T[1])!.indicators
      expect(e).toEqual({ id: 'ema-20', label: 'EMA 20', values: [{ key: 'value', text: '100.50', color: '#f5a623' }] })
      expect(legendAt(candles, [ema], T[2])!.indicators[0].values[0].text).toBe('101.25')
    })

    it('shows nothing for a candle the indicator has not warmed up for', () => {
      expect(legendAt(candles, [ema], T[0])!.indicators[0].values).toEqual([])
    })

    it('uses a point’s own colour (supertrend flips) and a neutral grey for a histogram', () => {
      const flip: IndicatorOutput = { id: 's', label: 'ST', pane: 'price', lines: [{ key: 'line', kind: 'line', color: COLORS.up, width: 2, points: [{ time: T[2], value: 97, color: COLORS.down }] }] }
      const hist: IndicatorOutput = { id: 'm', label: 'MACD', pane: 'separate', lines: [{ key: 'histogram', kind: 'histogram', color: COLORS.up, width: 1, points: [{ time: T[2], value: -0.4 }] }] }
      const out = legendAt(candles, [flip, hist], T[2])!.indicators
      expect(out[0].values[0].color).toBe(COLORS.down)
      expect(out[1].values[0]).toMatchObject({ text: '-0.40', color: COLORS.neutral })
    })

    it('reads several lines of one indicator in order', () => {
      const bb: IndicatorOutput = { id: 'bb', label: 'BB', pane: 'price', lines: ['upper', 'middle', 'lower'].map((key, i) => ({ key, kind: 'line' as const, color: '#fff', width: 1, points: [{ time: T[2], value: 110 - i * 10 }] })) }
      expect(legendAt(candles, [bb], T[2])!.indicators[0].values.map((v) => [v.key, v.text])).toEqual([['upper', '110.00'], ['middle', '100.00'], ['lower', '90.00']])
    })
  })
})
