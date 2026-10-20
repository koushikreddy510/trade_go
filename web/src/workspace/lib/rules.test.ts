// Rules in plain words, and the one-click rule from a drawn line.
import { describe, expect, it } from 'vitest'
import type { Drawing } from '../api/types'
import { levels, describeOperand, defaultOperand, describeCondition, describeExit, describeTrail, describeStop, describeTarget, draftFromLine, draftToPayload, newDraft, validateDraft } from './rules'

const line: Drawing = { id: 'L1', symbol: 'NSE:SBIN-EQ', kind: 'trend_line', points: [{ time: 1, price: 90 }, { time: 2, price: 95 }], style: {}, label: 'support' }
const drawings = [line]

describe('reading a rule', () => {
  it('explains a line breakout', () => {
    const d = draftFromLine(line, '1H', 'above')
    expect(describeCondition(d.condition, drawings)).toBe('Close crosses above line “support”')
  })

  it('explains indicator conditions', () => {
    expect(describeCondition({ type: 'cross', direction: 'above', a: { kind: 'indicator', name: 'ema', params: { period: 9 }, output: 'value' }, b: { kind: 'indicator', name: 'ema', params: { period: 21 }, output: 'value' } }))
      .toBe('EMA 9 crosses above EMA 21')
    expect(describeCondition({ type: 'compare', op: '<', a: { kind: 'indicator', name: 'rsi', params: { period: 14 }, output: 'value' }, b: { kind: 'value', value: 30 } })).toBe('RSI 14 < 30.00')
  })

  it('names the output of multi-line indicators', () => {
    expect(describeCondition({ type: 'compare', op: '>', a: { kind: 'close' }, b: { kind: 'indicator', name: 'bollinger', params: { period: 20, mult: 2 }, output: 'upper' } })).toBe('Close > Bollinger Bands 20, 2 upper')
  })

  it('joins groups with AND / OR', () => {
    const all = { type: 'all' as const, conditions: [{ type: 'compare' as const, op: '>' as const, a: { kind: 'close' as const }, b: { kind: 'value' as const, value: 10 } }, { type: 'compare' as const, op: '<' as const, a: { kind: 'volume' as const }, b: { kind: 'value' as const, value: 5 } }] }
    expect(describeCondition(all)).toBe('Close > 10.00 AND Volume < 5.00')
    expect(describeCondition({ ...all, type: 'any' })).toBe('Close > 10.00 OR Volume < 5.00')
  })

  it('calls it just "a line" when the chart’s lines are not loaded', () => {
    expect(describeCondition(draftFromLine(line, '1H', 'above').condition)).toBe('Close crosses above a line')
  })

  it('says so when the line was deleted', () => {
    expect(describeCondition(draftFromLine(line, '1H', 'above').condition, [])).toContain('a deleted line')
  })

  it('describes stops and targets', () => {
    expect(describeStop({ type: 'candle', buffer_pct: 0 })).toBe('stop at signal candle low/high')
    expect(describeStop({ type: 'atr', period: 14, mult: 2 })).toBe('stop 2×ATR(14)')
    expect(describeStop({ type: 'line', drawing_id: 'L1' }, drawings)).toBe('stop at line “support”')
    expect(describeTarget({ type: 'rr', ratio: 2 })).toBe('target 2R')
    expect(describeTarget(null)).toBe('no target')
  })
})

describe('reading an exit plan', () => {
  it('explains every kind of trailing stop', () => {
    expect(describeTrail({ type: 'candle', bars: 1, buffer_pct: 0 })).toBe('trail at the last candle low/high')
    expect(describeTrail({ type: 'candle', bars: 3, buffer_pct: 0.5, timeframe: '30m' })).toBe('trail at the 3-candle low/high ±0.5% on 30m candles')
    expect(describeTrail({ type: 'atr', period: 14, mult: 2 })).toBe('trail 2×ATR(14) from the close')
    expect(describeTrail({ type: 'pct', value: 1.5, timeframe: '1H' })).toBe('trail 1.5% from the close on 1H candles')
    expect(describeTrail({ type: 'indicator', name: 'ema', params: { period: 20 }, output: 'value' })).toBe('trail along EMA 20')
    expect(describeTrail({ type: 'line', drawing_id: 'L1' }, drawings)).toBe('trail along line “support”')
  })
  it('explains an exit condition and the timeframe it is read on', () => {
    const c = { type: 'cross' as const, direction: 'below' as const, a: { kind: 'close' as const }, b: { kind: 'value' as const, value: 100 } }
    expect(describeExit(c, '30m')).toBe('exit when Close crosses below 100.00 on 30m candles')
    expect(describeExit(c, null)).toBe('exit when Close crosses below 100.00')
  })
})

describe('rules that read a zone', () => {
  const zone: Drawing = { id: 'Z', symbol: 'NSE:SBIN-EQ', kind: 'rectangle', points: [{ time: 1, price: 90 }, { time: 2, price: 100 }], style: {}, label: 'supply' }
  const note: Drawing = { id: 'N', symbol: 'NSE:SBIN-EQ', kind: 'text', points: [{ time: 1, price: 95 }], style: {}, label: 'watch' }
  const withZone = [line, zone, note]

  it('says which edge of the zone is meant', () => {
    expect(describeOperand({ kind: 'line', drawing_id: 'Z', edge: 'bottom' }, withZone)).toBe('bottom of zone “supply”')
    expect(describeStop({ type: 'line', drawing_id: 'Z', edge: 'bottom' }, withZone)).toBe('stop at bottom of zone “supply”')
    expect(describeTrail({ type: 'line', drawing_id: 'Z', edge: 'top' }, withZone)).toBe('trail along top of zone “supply”')
  })
  it('breakouts start from the top edge and breakdowns from the bottom edge', () => {
    expect(draftFromLine(zone, '1H', 'above').condition).toMatchObject({ b: { kind: 'line', drawing_id: 'Z', edge: 'top' } })
    expect(draftFromLine(zone, '1H', 'below').condition).toMatchObject({ b: { kind: 'line', drawing_id: 'Z', edge: 'bottom' } })
    expect(draftFromLine(line, '1H', 'above').condition).toEqual({ type: 'cross', direction: 'above', a: { kind: 'close' }, b: { kind: 'line', drawing_id: 'L1' } }) // lines carry no edge
  })
  it('a zone without an edge is not ready to save', () => {
    const base = draftFromLine(line, '1H', 'above')
    const noEdge = { ...base, condition: { type: 'cross' as const, direction: 'above' as const, a: { kind: 'close' as const }, b: { kind: 'line' as const, drawing_id: 'Z' } } }
    expect(validateDraft(noEdge, withZone)).toEqual(['Pick the top or bottom edge of the zone.'])
    expect(validateDraft({ ...base, stop: { type: 'line', drawing_id: 'Z' } }, withZone)).toContain('Pick the top or bottom edge of the zone.')
    expect(validateDraft({ ...base, trail: { type: 'line', drawing_id: 'Z' } }, withZone)).toContain('Pick the top or bottom edge of the zone.')
    expect(validateDraft({ ...base, stop: { type: 'line', drawing_id: 'Z', edge: 'bottom' } }, withZone)).toEqual([])
  })
  it('a text note has no price, so no rule may read it', () => {
    const base = draftFromLine(line, '1H', 'above')
    expect(validateDraft({ ...base, stop: { type: 'line', drawing_id: 'N' } }, withZone)).toContain('A text note has no price; pick a line or a zone.')
  })
  it('only lines and zones are offered to rules', () => {
    expect(levels(withZone).map((x) => x.id)).toEqual(['L1', 'Z'])
    expect(defaultOperand('line', [note, zone])).toEqual({ kind: 'line', drawing_id: 'Z', edge: 'top' })
  })
})

describe('range breakouts and time windows', () => {
  const good = draftFromLine(line, '1H', 'above')
  const range = { type: 'cross' as const, direction: 'above' as const, a: { kind: 'close' as const }, b: { kind: 'highest' as const, bars: 20, source: 'high' as const } }

  it('reads naturally', () => {
    expect(describeCondition(range)).toBe('Close crosses above 20-candle high')
    expect(describeOperand({ kind: 'lowest', bars: 10, source: 'low' })).toBe('10-candle low')
    expect(describeOperand({ kind: 'highest', bars: 5, source: 'close' })).toBe('5-candle high of close')
    expect(describeOperand({ kind: 'highest', bars: 3, source: 'volume' })).toBe('3-candle high of volume')
    expect(describeCondition({ type: 'time_between', start: '09:20', end: '15:00' })).toBe('the candle closes between 09:20 and 15:00 IST')
    expect(describeCondition({ type: 'all', conditions: [range, { type: 'time_between', start: '09:30', end: '11:00' }] })).toBe('Close crosses above 20-candle high AND the candle closes between 09:30 and 11:00 IST')
  })
  it('default operands look back 20 candles at the matching side of the bar', () => {
    expect(defaultOperand('highest')).toEqual({ kind: 'highest', bars: 20, source: 'high' })
    expect(defaultOperand('lowest')).toEqual({ kind: 'lowest', bars: 20, source: 'low' })
  })
  it('wants a sensible look-back', () => {
    const bars = (n: number) => ({ ...good, condition: { ...range, b: { kind: 'highest' as const, bars: n, source: 'high' as const } } })
    expect(validateDraft(bars(20), drawings)).toEqual([])
    for (const n of [0, 501, 2.5, NaN]) expect(validateDraft(bars(n), drawings)).toEqual(['Look back over 1 to 500 candles.'])
  })
  it('checks time windows, inside groups and in exits too', () => {
    const win = (start: string, end: string) => ({ type: 'time_between' as const, start, end })
    expect(validateDraft({ ...good, condition: win('09:20', '15:00') }, drawings)).toEqual([])
    expect(validateDraft({ ...good, condition: win('', '15:00') }, drawings)).toEqual(['Give the time window as HH:MM.'])
    expect(validateDraft({ ...good, condition: win('9:20', '15:00') }, drawings)).toEqual(['Give the time window as HH:MM.'])
    expect(validateDraft({ ...good, condition: win('24:00', '25:00') }, drawings)).toEqual(['Give the time window as HH:MM.'])
    expect(validateDraft({ ...good, condition: { type: 'all', conditions: [win('15:00', '09:20')] } }, drawings)).toEqual(['The time window cannot run past midnight; the start must not be after the end.'])
    expect(validateDraft({ ...good, exit_condition: win('15:00', '09:20') }, drawings)).toHaveLength(1)
  })
})

describe('starting a rule from a line', () => {
  it('a breakout above is a BUY and a breakdown below is a SELL', () => {
    const up = draftFromLine(line, '5m', 'above')
    const down = draftFromLine(line, '5m', 'below')
    expect([up.side, up.condition]).toEqual(['BUY', { type: 'cross', direction: 'above', a: { kind: 'close' }, b: { kind: 'line', drawing_id: 'L1' } }])
    expect([down.side, down.condition]).toMatchObject(['SELL', { direction: 'below' }])
    expect(up).toMatchObject({ symbol: 'NSE:SBIN-EQ', timeframe: '5m', stop: { type: 'candle' }, target: { type: 'rr', ratio: 2 } })
  })
})

describe('checking a draft before saving', () => {
  const good = draftFromLine(line, '1H', 'above')

  it('accepts a sensible rule', () => {
    expect(validateDraft(good, drawings)).toEqual([])
  })
  it('wants a positive whole quantity', () => {
    expect(validateDraft({ ...good, quantity: 0 }, drawings)).toContain('Quantity must be a whole number above zero.')
    expect(validateDraft({ ...good, quantity: 1.5 }, drawings)).toHaveLength(1)
  })
  it('wants lines that exist', () => {
    expect(validateDraft(good, [])).toContain('Pick a line that exists on this chart.')
    expect(validateDraft({ ...good, stop: { type: 'line', drawing_id: 'gone' } }, drawings)).toContain('Pick a line for the stop.')
  })
  it('checks stop and target numbers', () => {
    expect(validateDraft({ ...good, stop: { type: 'pct', value: 0 } }, drawings)).toContain('The stop percentage must be above zero.')
    expect(validateDraft({ ...good, target: { type: 'rr', ratio: 0 } }, drawings)).toContain('The reward:risk ratio must be above zero.')
  })
  it('checks the trailing stop', () => {
    expect(validateDraft({ ...good, trail: { type: 'line', drawing_id: 'gone' } }, drawings)).toContain('Pick a line for the trailing stop.')
    expect(validateDraft({ ...good, trail: { type: 'pct', value: 0 } }, drawings)).toContain('The trailing percentage must be above zero.')
    expect(validateDraft({ ...good, trail: { type: 'atr', period: 14, mult: 0 } }, drawings)).toContain('The trailing ATR period and multiple must be above zero.')
    expect(validateDraft({ ...good, trail: { type: 'candle', bars: 51, buffer_pct: 0 } }, drawings)).toContain('Trail over 1 to 50 candles.')
    expect(validateDraft({ ...good, trail: { type: 'candle', bars: 2, buffer_pct: -1 } }, drawings)).toContain('The trailing buffer cannot be negative.')
    expect(validateDraft({ ...good, trail: { type: 'candle', bars: 2, buffer_pct: 0.2 } }, drawings)).toEqual([])
  })
  it('checks the exit condition like the entry condition', () => {
    const bad = { type: 'compare' as const, op: '>' as const, a: { kind: 'line' as const, drawing_id: 'gone' }, b: { kind: 'close' as const } }
    expect(validateDraft({ ...good, exit_condition: bad }, drawings)).toContain('Pick a line that exists on this chart.')
    expect(validateDraft({ ...good, exit_condition: { type: 'any', conditions: [] } }, drawings)).toContain('A group needs at least one condition.')
  })
  it('looks inside groups', () => {
    const grouped = { ...good, condition: { type: 'all' as const, conditions: [] } }
    expect(validateDraft(grouped, drawings)).toContain('A group needs at least one condition.')
  })
})

describe('building blocks', () => {
  it('a fresh draft is a valid-looking BUY on the current symbol and timeframe', () => {
    expect(newDraft('NSE:TCS-EQ', '15m')).toMatchObject({ symbol: 'NSE:TCS-EQ', timeframe: '15m', side: 'BUY', enabled: true, once: false })
  })
  it('default operands per kind', () => {
    expect(defaultOperand('close')).toEqual({ kind: 'close' })
    expect(defaultOperand('line', drawings)).toEqual({ kind: 'line', drawing_id: 'L1' })
    expect(defaultOperand('indicator')).toMatchObject({ kind: 'indicator', name: 'ema', params: { period: 20 } })
  })
  it('the payload never carries the id (the URL does)', () => {
    expect(draftToPayload({ ...newDraft('NSE:A-EQ', '1H'), id: 'abc' })).not.toHaveProperty('id')
  })
})
