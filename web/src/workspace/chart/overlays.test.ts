// What the chart shows on top of the candles: stops, targets, signal arrows, lines, indicators.
import { describe, expect, it } from 'vitest'
import type { BacktestOpen, BacktestTrade, Drawing, Position, Quote, Signal } from '../api/types'
import { candle, ist } from '../lib/testutil'
import type { IndicatorConfig } from '../store/state'
import { COLORS, backtestMarkers, backtestSegments, candleAt, drawingAnchors, exitMarkers, indicatorOutputs, indicatorSignature, positionLines, signalMarkers } from './overlays'

const SBIN = 'NSE:SBIN-EQ'
const pos = (over: Partial<Position> = {}): Position => ({
  id: 'p1', source: 'paper', signal_id: null, symbol: SBIN, side: 'BUY', quantity: 10, entry_price: 101, stop: 99.6, target: 103.8, status: 'open',
  opened_at: 1, closed_at: null, exit_price: null, exit_reason: null, realized_pnl: null, ...over,
})
const quote = (price: number): Quote => ({ symbol: SBIN, price, ts: 1, prev_close: null, open: null, high: null, low: null, volume: null, change: null, change_pct: null })

describe('entry, stop-loss and target lines', () => {
  it('draws all three for an open position', () => {
    const lines = positionLines([pos()], SBIN)
    expect(lines.map((l) => [l.id, l.price, l.title, l.color])).toEqual([
      ['p1:entry', 101, 'BUY 10 @ 101.00', COLORS.entry],
      ['p1:stop', 99.6, 'SL 99.60', COLORS.down],
      ['p1:target', 103.8, 'TP 103.80', COLORS.up],
    ])
    expect(lines.filter((l) => l.dashed).map((l) => l.id)).toEqual(['p1:stop', 'p1:target'])
  })

  it('shows live profit on the entry line from the latest price', () => {
    expect(positionLines([pos()], SBIN, quote(103))[0].title).toBe('BUY 10 @ 101.00  +20.00')
    expect(positionLines([pos({ side: 'SELL', stop: 102, target: 98 })], SBIN, quote(103))[0].title).toBe('SELL 10 @ 101.00  -20.00')
  })

  it('omits a stop or target the position does not have', () => {
    expect(positionLines([pos({ stop: null, target: null })], SBIN).map((l) => l.id)).toEqual(['p1:entry'])
  })

  it('only shows open positions of the chart’s own symbol', () => {
    expect(positionLines([pos({ symbol: 'NSE:TCS-EQ' }), pos({ id: 'p2', status: 'closed' })], SBIN)).toEqual([])
  })
})

describe('a trailing stop on the chart', () => {
  it('shows the moved stop as the trail and the first stop faintly beside it', () => {
    const lines = positionLines([pos({ stop: 100.5, initial_stop: 99.6, trail: { type: 'pct', value: 1 } })], SBIN)
    expect(lines.map((l) => [l.id, l.price, l.title])).toEqual([
      ['p1:entry', 101, 'BUY 10 @ 101.00'],
      ['p1:stop', 100.5, 'Trail SL 100.50'],
      ['p1:initial_stop', 99.6, 'Initial SL 99.60'],
      ['p1:target', 103.8, 'TP 103.80'],
    ])
    expect(lines[2].color).toBe(COLORS.neutral)
  })
  it('is an ordinary SL until the trail has moved it', () => {
    const lines = positionLines([pos({ initial_stop: 99.6, trail: { type: 'pct', value: 1 } })], SBIN)
    expect(lines.map((l) => l.title)).toContain('SL 99.60')
    expect(lines.map((l) => l.id)).not.toContain('p1:initial_stop')
  })
  it('a position without a trail never shows an initial line', () => {
    expect(positionLines([pos({ stop: 100.5, initial_stop: 99.6 })], SBIN).map((l) => l.id)).not.toContain('p1:initial_stop')
  })
})

describe('exit arrows', () => {
  const bars = [100, 101, 102].map((c, i) => candle(ist(2026, 5, 4, 9 + i, 15), c, c, c, c))
  const closed = (over: Partial<Position> = {}) => pos({ status: 'closed', closed_at: bars[1].time + 600, exit_price: 100.5, exit_reason: 'stop', realized_pnl: -5, ...over })

  it('marks the candle the trade ended in, with how and where', () => {
    expect(exitMarkers([closed()], bars, SBIN, '1H')).toEqual([
      { id: 'p1:exit', time: bars[1].time, position: 'aboveBar', shape: 'arrowDown', color: COLORS.down, text: 'SL 100.50' },
    ])
  })
  it('names a rule exit and colours a winner green; a short exit sits below the bar', () => {
    const [m] = exitMarkers([closed({ side: 'SELL', exit_reason: 'exit_rule', realized_pnl: 12 })], bars, SBIN, '1H')
    expect(m).toMatchObject({ text: 'Rule exit 100.50', color: COLORS.up, position: 'belowBar', shape: 'arrowUp' })
  })
  it('skips open positions, other symbols and trades outside the loaded candles', () => {
    expect(exitMarkers([pos(), closed({ symbol: 'NSE:TCS-EQ' }), closed({ closed_at: bars[0].time - 1 }), closed({ closed_at: bars[2].time + 3600 })], bars, SBIN, '1H')).toEqual([])
  })
  it('is sorted by time', () => {
    const out = exitMarkers([closed({ id: 'b', closed_at: bars[2].time }), closed({ id: 'a', closed_at: bars[0].time })], bars, SBIN, '1H')
    expect(out.map((m) => m.id)).toEqual(['a:exit', 'b:exit'])
  })
})

describe('signal arrows', () => {
  const H = (h: number, m: number) => ist(2026, 10, 19, h, m)
  const hourly = [candle(H(9, 15), 1, 1, 1, 1), candle(H(10, 15), 1, 1, 1, 1), candle(H(11, 15), 1, 1, 1, 1)]
  const sig = (over: Partial<Signal> = {}): Signal => ({ id: 's1', rule_id: 'r', symbol: SBIN, timeframe: '1H', side: 'BUY', bar_time: H(10, 15), entry: 101, stop: 99.6, target: 103.8, status: 'open', reason: '', ...over })

  it('a BUY signal is an up arrow under the candle it fired on', () => {
    expect(signalMarkers([sig()], hourly, SBIN)).toEqual([{ id: 's1', time: H(10, 15), position: 'belowBar', shape: 'arrowUp', color: COLORS.up, text: 'BUY 101.00' }])
  })

  it('a SELL signal is a down arrow above the candle', () => {
    expect(signalMarkers([sig({ side: 'SELL' })], hourly, SBIN)[0]).toMatchObject({ position: 'aboveBar', shape: 'arrowDown', color: COLORS.down })
  })

  it('on a finer chart the arrow sits on the candle containing the signal bar’s close', () => {
    const fiveMin = [H(11, 5), H(11, 10), H(11, 15)].map((t) => candle(t, 1, 1, 1, 1))
    // a 1H signal bar 10:15-11:15 closed at 11:15; the 5m candle that ends then starts at 11:10
    expect(signalMarkers([sig()], fiveMin, SBIN)[0].time).toBe(H(11, 10))
  })

  it('a rejected signal is a quiet grey dot', () => {
    expect(signalMarkers([sig({ status: 'rejected' })], hourly, SBIN)[0]).toMatchObject({ shape: 'circle', color: COLORS.neutral, text: 'skipped' })
  })

  it('ignores other symbols and signals older than the loaded history', () => {
    expect(signalMarkers([sig({ symbol: 'NSE:TCS-EQ' }), sig({ id: 'old', bar_time: H(9, 15) - 86400 * 30 })], hourly, SBIN)).toEqual([])
  })

  it('returns markers in time order, as the chart library requires', () => {
    const out = signalMarkers([sig({ id: 'b', bar_time: H(10, 15) }), sig({ id: 'a', bar_time: H(9, 15) })], hourly, SBIN)
    expect(out.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('drawn lines', () => {
  it('are anchored in bar-index space, so a weekend gap is one bar wide', () => {
    const fri = [ist(2026, 10, 16, 14, 15), ist(2026, 10, 16, 15, 15)]
    const mon = [ist(2026, 10, 19, 9, 15), ist(2026, 10, 19, 10, 15)]
    const times = [...fri, ...mon]
    const d: Drawing = { id: 'd', symbol: SBIN, kind: 'trend_line', style: {}, label: '', points: [{ time: fri[0], price: 100 }, { time: mon[1], price: 103 }] }
    expect(drawingAnchors(d, times, '1H')).toEqual([{ index: 0, price: 100 }, { index: 3, price: 103 }])
  })
  it('a horizontal line has one anchor', () => {
    const d: Drawing = { id: 'h', symbol: SBIN, kind: 'horizontal_line', style: {}, label: '', points: [{ time: 5, price: 99 }] }
    expect(drawingAnchors(d, [10, 20], '1H')).toHaveLength(1)
  })
  it('no candles, no anchors', () => {
    expect(drawingAnchors({ id: 'h', symbol: SBIN, kind: 'horizontal_line', style: {}, label: '', points: [{ time: 5, price: 99 }] }, [], '1H')).toEqual([])
  })
})

describe('indicator overlays', () => {
  const candles = Array.from({ length: 60 }, (_, i) => candle(1000 + i * 60, 100 + i, 101 + i, 99 + i, 100.5 + i))
  const cfg = (name: IndicatorConfig['name'], params: Record<string, number> = {}): IndicatorConfig => ({ id: name, name, params })

  it('moving averages overlay the price pane and skip the warm-up', () => {
    const [ema] = indicatorOutputs([cfg('ema', { period: 20 })], candles)
    expect(ema.pane).toBe('price')
    expect(ema.label).toBe('EMA 20')
    expect(ema.lines[0].points).toHaveLength(41) // first value on the 20th bar
    expect(ema.lines[0].points[0].time).toBe(candles[19].time)
  })

  it('RSI gets its own pane with 30/70 guide lines', () => {
    const [rsi] = indicatorOutputs([cfg('rsi')], candles)
    expect(rsi).toMatchObject({ pane: 'separate', levels: [30, 70], label: 'RSI 14' })
  })

  it('Bollinger draws upper, middle and lower bands', () => {
    const [bb] = indicatorOutputs([cfg('bollinger')], candles)
    expect(bb.lines.map((l) => l.key)).toEqual(['upper', 'middle', 'lower'])
    const i = bb.lines[0].points.length - 1
    expect(bb.lines[0].points[i].value).toBeGreaterThan(bb.lines[1].points[i].value)
    expect(bb.lines[1].points[i].value).toBeGreaterThan(bb.lines[2].points[i].value)
  })

  it('Supertrend is coloured by direction (green up, red down)', () => {
    const rising = indicatorOutputs([cfg('supertrend')], candles)[0].lines[0].points
    expect(new Set(rising.slice(5).map((p) => p.color))).toEqual(new Set([COLORS.up]))
    const falling = candles.map((c, i) => candle(c.time, 200 - i, 201 - i, 199 - i, 199.5 - i))
    const down = indicatorOutputs([cfg('supertrend')], falling)[0].lines[0].points
    expect(down[down.length - 1].color).toBe(COLORS.down)
  })

  it('MACD has a histogram plus the MACD and signal lines', () => {
    const [macd] = indicatorOutputs([cfg('macd')], candles)
    expect(macd.lines.map((l) => [l.key, l.kind])).toEqual([['histogram', 'histogram'], ['macd', 'line'], ['signal', 'line']])
  })

  it('the new oscillators sit in their own pane with their own guide lines', () => {
    const out = indicatorOutputs(['stochastic', 'cci', 'williams_r', 'adx', 'roc'].map((name) => cfg(name)), candles)
    expect(out.map((o) => [o.pane, o.levels])).toEqual([['separate', [20, 80]], ['separate', [-100, 100]], ['separate', [-80, -20]], ['separate', [25]], ['separate', [0]]])
    expect(out[0].lines.map((l) => l.key)).toEqual(['k', 'd'])
    expect(out[3].lines.map((l) => l.key)).toEqual(['adx', 'plus_di', 'minus_di'])
  })

  it('Donchian and Keltner draw three bands over the price, Parabolic SAR draws dots', () => {
    const [dc, kc, ps] = indicatorOutputs(['donchian', 'keltner', 'psar'].map((name) => cfg(name)), candles)
    expect([dc.pane, kc.pane, ps.pane]).toEqual(['price', 'price', 'price'])
    expect(dc.lines.map((l) => l.key)).toEqual(['upper', 'middle', 'lower'])
    expect(kc.lines[0].points[kc.lines[0].points.length - 1].value).toBeGreaterThan(kc.lines[2].points[kc.lines[2].points.length - 1].value)
    expect(ps.lines[0].dots).toBe(true)
  })

  it('several indicators get different colours', () => {
    const [a, b] = indicatorOutputs([{ id: 'a', name: 'ema', params: { period: 9 } }, { id: 'b', name: 'ema', params: { period: 21 } }], candles)
    expect(a.lines[0].color).not.toBe(b.lines[0].color)
  })

  it('nothing to draw without candles', () => {
    expect(indicatorOutputs([cfg('ema')], [])).toEqual([])
  })
})

describe('indicatorSignature (when the chart must rebuild its indicator series)', () => {
  const cfg = [{ id: 'ema-20', name: 'ema' as const, params: { period: 20 } }]
  const candles = Array.from({ length: 30 }, (_, i) => candle(1_000_000 + i * 3600, 100 + i, 101 + i, 99 + i, 100 + i))

  it('is the same when only the values change, so a live tick does not rebuild the panes', () => {
    const a = indicatorSignature(indicatorOutputs(cfg, candles), 'ema-20')
    const b = indicatorSignature(indicatorOutputs(cfg, [...candles.slice(0, -1), candle(candles[29].time, 1, 500, 1, 400)]), 'ema-20')
    expect(a).toBe(b)
  })

  it('changes when candles arrive after the indicator list was already set (this crashed the chart once)', () => {
    expect(indicatorSignature(indicatorOutputs(cfg, []), 'ema-20')).not.toBe(indicatorSignature(indicatorOutputs(cfg, candles), 'ema-20'))
  })

  it('changes when an indicator is added or its shape differs', () => {
    const more = [...cfg, { id: 'macd-12-26-9', name: 'macd' as const, params: { fast: 12, slow: 26, signal: 9 } }]
    expect(indicatorSignature(indicatorOutputs(more, candles), 'a|b')).not.toBe(indicatorSignature(indicatorOutputs(cfg, candles), 'a'))
  })
})

describe('backtest trades on the chart', () => {
  const H = 3600
  const candles = [candle(10 * H, 100, 101, 99, 100), candle(11 * H, 100, 102, 99, 101), candle(12 * H, 101, 103, 100, 102), candle(13 * H, 102, 104, 101, 103)]
  const iso = (t: number) => new Date(t * 1000).toISOString()
  const trade = (over: Partial<BacktestTrade> = {}): BacktestTrade => ({
    symbol: SBIN, side: 'BUY', quantity: 10, entry_time: iso(11 * H), entry_price: 100, exit_time: iso(13 * H), exit_price: 110, exit_reason: 'target', pnl: 100, pnl_pct: 10, initial_stop: 95, ...over,
  })

  it('puts an entry stamped at a candle close on the candle that closed', () => {
    expect(candleAt(candles, iso(11 * H), '1H')?.time).toBe(10 * H)
    expect(candleAt(candles, iso(12 * H + 5), '1H')?.time).toBe(12 * H) // mid-candle (a stop)
  })

  it('has no candle for times outside the loaded history', () => {
    expect(candleAt(candles, iso(9 * H), '1H')).toBeNull()
    expect(candleAt(candles, iso(15 * H), '1H')).toBeNull()
    expect(candleAt([], iso(11 * H), '1H')).toBeNull()
  })

  it('draws a green entry arrow and an exit arrow coloured by the result', () => {
    const m = backtestMarkers([trade(), trade({ entry_time: iso(12 * H), exit_time: iso(13 * H), exit_price: 95, exit_reason: 'stop', pnl: -50 })], [], candles, SBIN, '1H')
    expect(m.map((x) => [x.id, x.shape, x.position, x.color, x.text])).toEqual([
      ['bt:0:in', 'arrowUp', 'belowBar', COLORS.up, 'BUY 10 @ 100.00'],
      ['bt:1:in', 'arrowUp', 'belowBar', COLORS.up, 'BUY 10 @ 100.00'],
      ['bt:0:out', 'arrowDown', 'aboveBar', COLORS.up, 'TP 110.00 +100.00'],
      ['bt:1:out', 'arrowDown', 'aboveBar', COLORS.down, 'SL 95.00 -50.00'],
    ])
  })

  it('flips the arrows for a short', () => {
    const m = backtestMarkers([trade({ side: 'SELL' })], [], candles, SBIN, '1H')
    expect(m.map((x) => [x.shape, x.position])).toEqual([['arrowDown', 'aboveBar'], ['arrowUp', 'belowBar']])
  })

  it('shows only entries for positions still open, and only for this symbol', () => {
    const open: BacktestOpen = { symbol: SBIN, side: 'BUY', quantity: 5, entry_time: iso(12 * H), entry_price: 101, stop: null, target: null, last_price: 103, unrealized_pnl: 10 }
    expect(backtestMarkers([trade({ symbol: 'NSE:TCS-EQ' })], [open, { ...open, symbol: 'NSE:TCS-EQ' }], candles, SBIN, '1H').map((x) => x.id)).toEqual(['bt:open0:in'])
  })

  it('links entry to exit, but not trades inside one candle or off the chart', () => {
    const segs = backtestSegments([trade(), trade({ exit_time: iso(11 * H) }), trade({ exit_time: iso(20 * H) })], candles, SBIN, '1H')
    expect(segs).toEqual([{ id: 'bt:0', from: { time: 10 * H, price: 100 }, to: { time: 12 * H, price: 110 }, color: COLORS.up }])
  })
})
