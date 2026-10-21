// Building and explaining entry rules. A rule is a small JSON tree (see
// trading_service/terminal/conditions.py); these helpers make it easy to build one in
// a form and to read it back as a sentence.
import type { Condition, Drawing, Edge, Operand, RuleDraft, StopSpec, TargetSpec, Timeframe, TrailSpec } from '../api/types'
import { INDICATORS, indicatorLabel } from './indicators'
import { fmtPrice } from './format'

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const PRICE_LABEL: Record<string, string> = { open: 'Open', high: 'High', low: 'Low', close: 'Close', volume: 'Volume' }

/** `drawings` = the lines of the rule's own chart. Omit it when they are not loaded; a line is then just "a line". */
export function describeOperand(op: Operand, drawings?: Drawing[]): string {
  switch (op.kind) {
    case 'value':
      return fmtPrice(op.value)
    case 'line': {
      const d = drawings?.find((x) => x.id === op.drawing_id)
      if (d?.kind === 'rectangle') return `${op.edge ?? 'top'} of zone “${d.label || 'rectangle'}”`
      if (d) return `line “${d.label || d.kind.replace('_', ' ')}”`
      return drawings ? 'a deleted line' : 'a line'
    }
    case 'highest':
    case 'lowest':
      return `${op.bars}-candle ${op.kind === 'highest' ? 'high' : 'low'}${op.source === (op.kind === 'highest' ? 'high' : 'low') ? '' : ` of ${PRICE_LABEL[op.source].toLowerCase()}`}`
    case 'indicator': {
      const label = indicatorLabel(op.name, op.params)
      return INDICATORS[op.name].outputs.length > 1 && op.output ? `${label} ${op.output}` : label
    }
    default:
      return PRICE_LABEL[op.kind]
  }
}

export function describeCondition(c: Condition, drawings?: Drawing[]): string {
  if (c.type === 'cross') return `${describeOperand(c.a, drawings)} crosses ${c.direction} ${describeOperand(c.b, drawings)}`
  if (c.type === 'compare') return `${describeOperand(c.a, drawings)} ${c.op} ${describeOperand(c.b, drawings)}`
  if (c.type === 'time_between') return `the candle closes between ${c.start} and ${c.end} IST`
  return c.conditions.map((x) => describeCondition(x, drawings)).join(c.type === 'all' ? ' AND ' : ' OR ')
}

export function describeStop(s: StopSpec, drawings?: Drawing[]): string {
  switch (s.type) {
    case 'fixed': return `stop at ${fmtPrice(s.price)}`
    case 'pct': return `stop ${s.value}% from entry`
    case 'atr': return `stop ${s.mult}×ATR(${s.period})`
    case 'candle': return s.buffer_pct ? `stop at signal candle extreme ±${s.buffer_pct}%` : 'stop at signal candle low/high'
    case 'line': return `stop at ${describeOperand({ kind: 'line', drawing_id: s.drawing_id, edge: s.edge }, drawings)}`
  }
}

export function describeTarget(t: TargetSpec | null): string {
  if (!t) return 'no target'
  switch (t.type) {
    case 'rr': return `target ${t.ratio}R`
    case 'pct': return `target ${t.value}%`
    case 'fixed': return `target ${fmtPrice(t.price)}`
  }
}

export function describeTrail(t: TrailSpec, drawings?: Drawing[]): string {
  const on = t.timeframe ? ` on ${t.timeframe} candles` : ''
  switch (t.type) {
    case 'candle': return `trail at the ${t.bars > 1 ? `${t.bars}-candle ` : 'last candle '}low/high${t.buffer_pct ? ` ±${t.buffer_pct}%` : ''}${on}`
    case 'atr': return `trail ${t.mult}×ATR(${t.period}) from the close${on}`
    case 'pct': return `trail ${t.value}% from the close${on}`
    case 'indicator': return `trail along ${describeOperand({ kind: 'indicator', name: t.name, params: t.params, output: t.output })}${on}`
    case 'line': return `trail along ${describeOperand({ kind: 'line', drawing_id: t.drawing_id, edge: t.edge }, drawings)}${on}`
  }
}

export function describeExit(c: Condition, timeframe: Timeframe | null | undefined, drawings?: Drawing[]): string {
  return `exit when ${describeCondition(c, drawings)}${timeframe ? ` on ${timeframe} candles` : ''}`
}

// ---- drafts ----------------------------------------------------------------
export function newDraft(symbol: string, timeframe: Timeframe): RuleDraft {
  return {
    symbol, timeframe, name: '', side: 'BUY', quantity: 1, enabled: true, once: false,
    condition: { type: 'cross', direction: 'above', a: { kind: 'close' }, b: { kind: 'indicator', name: 'ema', params: { period: 20 }, output: 'value' } },
    stop: { type: 'candle', buffer_pct: 0 },
    target: { type: 'rr', ratio: 2 },
    trail: null, exit_condition: null, exit_timeframe: null, exit_condition_2: null, exit_timeframe_2: null,
    entry_score_indicator: null, entry_levels: null,
  }
}

/** Drawings a rule can read a price from (a text note has none). */
export const levels = (drawings: Drawing[]): Drawing[] => drawings.filter((d) => d.kind !== 'text')

/** The `edge` a fresh reference to `d` needs: zones must name one, lines never do. */
export const edgeFor = (d: Drawing | undefined): { edge?: Edge } => (d?.kind === 'rectangle' ? { edge: 'top' } : {})

export function defaultTrail(type: TrailSpec['type'], drawings: Drawing[] = []): TrailSpec {
  switch (type) {
    case 'candle': return { type, bars: 1, buffer_pct: 0 }
    case 'atr': return { type, period: 14, mult: 2 }
    case 'pct': return { type, value: 1 }
    case 'indicator': return { type, name: 'ema', params: { ...INDICATORS.ema.defaults }, output: 'value' }
    case 'line': { const d = levels(drawings)[0]; return { type, drawing_id: d?.id ?? '', ...edgeFor(d) } }
  }
}

/** "Enter when the close crosses above/below this line" - the one-click starting point from a drawing. */
export function draftFromLine(d: Drawing, timeframe: Timeframe, direction: 'above' | 'below'): RuleDraft {
  const buy = direction === 'above'
  return {
    ...newDraft(d.symbol, timeframe),
    name: `${buy ? 'Breakout above' : 'Breakdown below'} ${d.label || d.kind.replace('_', ' ')}`,
    side: buy ? 'BUY' : 'SELL',
    condition: { type: 'cross', direction, a: { kind: 'close' }, b: { kind: 'line', drawing_id: d.id, ...(d.kind === 'rectangle' ? { edge: buy ? 'top' : 'bottom' } : {}) } },
  }
}

export function defaultOperand(kind: Operand['kind'], drawings: Drawing[] = []): Operand {
  switch (kind) {
    case 'value': return { kind: 'value', value: 0 }
    case 'highest': return { kind: 'highest', bars: 20, source: 'high' }
    case 'lowest': return { kind: 'lowest', bars: 20, source: 'low' }
    case 'line': { const d = levels(drawings)[0]; return { kind: 'line', drawing_id: d?.id ?? '', ...edgeFor(d) } }
    case 'indicator': return { kind: 'indicator', name: 'ema', params: { ...INDICATORS.ema.defaults }, output: 'value' }
    default: return { kind }
  }
}

/** Problems worth telling the user about before they press Save (the server validates again). */
export function validateDraft(d: RuleDraft, drawings: Drawing[]): string[] {
  const errors: string[] = []
  // null = fine, otherwise what is wrong with this reference
  const refProblem = (id: string, edge: Edge | undefined, missing: string): string | null => {
    const d = drawings.find((x) => x.id === id)
    if (!d) return missing
    if (d.kind === 'text') return 'A text note has no price; pick a line or a zone.'
    if (d.kind === 'rectangle' && !edge) return 'Pick the top or bottom edge of the zone.'
    return null
  }
  const add = (p: string | null) => { if (p && !errors.includes(p)) errors.push(p) }
  if (!Number.isInteger(d.quantity) || d.quantity <= 0) errors.push('Quantity must be a whole number above zero.')
  const check = (op: Operand) => {
    if ((op.kind === 'highest' || op.kind === 'lowest') && !(Number.isInteger(op.bars) && op.bars >= 1 && op.bars <= 500)) add('Look back over 1 to 500 candles.')
    if (op.kind === 'line') add(refProblem(op.drawing_id, op.edge, 'Pick a line that exists on this chart.'))
    if (op.kind === 'value' && !Number.isFinite(op.value)) errors.push('A fixed level must be a number.')
  }
  const walk = (c: Condition) => {
    if (c.type === 'cross' || c.type === 'compare') {
      check(c.a)
      check(c.b)
    } else if (c.type === 'time_between') {
      if (!CLOCK.test(c.start) || !CLOCK.test(c.end)) add('Give the time window as HH:MM.')
      else if (c.start > c.end) add('The time window cannot run past midnight; the start must not be after the end.')
    } else {
      if (c.conditions.length === 0) errors.push('A group needs at least one condition.')
      c.conditions.forEach(walk)
    }
  }
  walk(d.condition)
  if (d.exit_condition) walk(d.exit_condition)
  if (d.exit_condition_2) walk(d.exit_condition_2)
  if (d.entry_levels) {
    if (d.entry_levels.length < 1 || d.entry_levels.length > 3)
      errors.push('Entry levels must have 1 to 3 items.')
    else {
      d.entry_levels.forEach((lvl, i) => {
        if (!Number.isInteger(lvl.qty) || lvl.qty < 1) errors.push(`Entry level ${i + 1}: quantity must be a positive whole number.`)
        if (lvl.max_dist_pct !== undefined && !(lvl.max_dist_pct > 0)) errors.push(`Entry level ${i + 1}: max distance must be above zero.`)
      })
      const last = d.entry_levels[d.entry_levels.length - 1]
      if (last.max_dist_pct !== undefined) errors.push('The last entry level must be the catch-all (no max distance).')
    }
  }
  const t = d.trail
  if (t?.type === 'line') add(refProblem(t.drawing_id, t.edge, 'Pick a line for the trailing stop.'))
  if (t?.type === 'pct' && !(t.value > 0)) errors.push('The trailing percentage must be above zero.')
  if (t?.type === 'atr' && !(t.period > 0 && t.mult > 0)) errors.push('The trailing ATR period and multiple must be above zero.')
  if (t?.type === 'candle' && !(Number.isInteger(t.bars) && t.bars >= 1 && t.bars <= 50)) errors.push('Trail over 1 to 50 candles.')
  if (t?.type === 'candle' && !(t.buffer_pct >= 0)) errors.push('The trailing buffer cannot be negative.')
  if (d.stop.type === 'line') add(refProblem(d.stop.drawing_id, d.stop.edge, 'Pick a line for the stop.'))
  if (d.stop.type === 'fixed' && !(d.stop.price > 0)) errors.push('The stop price must be above zero.')
  if (d.stop.type === 'pct' && !(d.stop.value > 0)) errors.push('The stop percentage must be above zero.')
  if (d.target?.type === 'rr' && !(d.target.ratio > 0)) errors.push('The reward:risk ratio must be above zero.')
  return errors
}

/** What we POST. The server fills defaults and validates. */
export function draftToPayload(d: RuleDraft): Record<string, unknown> {
  const { id: _id, ...rest } = d
  void _id
  return rest
}
