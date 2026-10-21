// What gets drawn on top of the candles, as plain data. Keeping this separate from the
// canvas code means "is my stop visible, and where?" can be tested without a browser.
import type { BacktestOpen, BacktestTrade, Candle, Drawing, Position, Quote, Signal, Timeframe } from '../api/types'
import { INDICATORS, computeIndicator, indicatorLabel } from '../lib/indicators'
import { anchorIndex } from '../lib/lines'
import { fmtPnl, fmtPrice } from '../lib/format'
import { chartPalette, type Theme } from '../lib/theme'
import { tfSeconds } from '../lib/timeframes'
import type { IndicatorConfig } from '../store/state'

export const COLORS = { up: '#26a69a', down: '#ef5350', entry: '#e8e8e8', neutral: '#787b86', line: '#f7b955', selected: '#ffffff' }
/** Chart canvas colours: TradingView's black theme. */
export const THEME = { bg: '#000000', text: '#7a7a7a', grid: '#161616', border: '#242424', level: '#3a3a3a', volumeUp: 'rgba(38,166,154,.35)', volumeDown: 'rgba(239,83,80,.35)' }

/** Point the shared colours at the chosen theme. They are module-level on purpose (many pure helpers read them);
 *  call it before the state that depends on them re-renders. */
export function applyTheme(t: Theme): void {
  Object.assign(THEME, chartPalette(t))
  Object.assign(COLORS, { up: t.up, down: t.down, entry: t.accent, neutral: t.muted })
}

// ------------------------------------------------------------------- positions
export type PriceLineSpec = { id: string; price: number; color: string; title: string; dashed: boolean }

/** Entry, stop-loss and target of every open position on this symbol. */
export function positionLines(positions: Position[], symbol: string, quote?: Quote): PriceLineSpec[] {
  const out: PriceLineSpec[] = []
  for (const p of positions) {
    if (p.symbol !== symbol || p.status !== 'open') continue
    const pnl = quote && p.last_price === undefined ? (quote.price - p.entry_price) * (p.side === 'BUY' ? 1 : -1) * p.quantity * (p.multiplier ?? 1) : p.unrealized_pnl
    const live = pnl === undefined ? '' : `  ${fmtPnl(pnl)}`
    out.push({ id: `${p.id}:entry`, price: p.entry_price, color: COLORS.entry, dashed: false, title: `${p.side} ${p.quantity} @ ${fmtPrice(p.entry_price)}${live}` })
    if (p.stop !== null) {
      const trailed = p.trail && p.initial_stop != null && p.initial_stop !== p.stop // the trail has moved it from where it began
      out.push({ id: `${p.id}:stop`, price: p.stop, color: COLORS.down, dashed: true, title: trailed ? `Trail SL ${fmtPrice(p.stop)}` : `SL ${fmtPrice(p.stop)}` })
      if (trailed) out.push({ id: `${p.id}:initial_stop`, price: p.initial_stop!, color: COLORS.neutral, dashed: true, title: `Initial SL ${fmtPrice(p.initial_stop!)}` })
    }
    if (p.target !== null) out.push({ id: `${p.id}:target`, price: p.target, color: COLORS.up, dashed: true, title: `TP ${fmtPrice(p.target)}` })
  }
  return out
}

// --------------------------------------------------------------------- signals
export type MarkerSpec = { id: string; time: number; position: 'aboveBar' | 'belowBar'; shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'; color: string; text: string }

/** Arrows at the candle on which each signal fired (the candle containing the signal bar's close). */
export function signalMarkers(signals: Signal[], candles: Candle[], symbol: string): MarkerSpec[] {
  if (candles.length === 0) return []
  const out: MarkerSpec[] = []
  for (const s of signals) {
    if (s.symbol !== symbol) continue
    const firedAt = s.bar_time + tfSeconds(s.timeframe) // the signal bar's close
    let hit: Candle | undefined
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].time < firedAt) { hit = candles[i]; break }
    }
    if (!hit || firedAt <= candles[0].time) continue // before the loaded history
    const buy = s.side === 'BUY'
    if (s.status === 'rejected') out.push({ id: s.id, time: hit.time, position: buy ? 'belowBar' : 'aboveBar', shape: 'circle', color: COLORS.neutral, text: 'skipped' })
    else out.push({ id: s.id, time: hit.time, position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? COLORS.up : COLORS.down, text: `${s.side} ${fmtPrice(s.entry)}` })
  }
  return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)) // lightweight-charts requires ascending order
}

const EXIT_WORD: Record<string, string> = { stop: 'SL', target: 'TP', manual: 'Exit', exit_rule: 'Rule exit' }

/** An arrow at the candle each closed position left on, coloured by its result. */
export function exitMarkers(positions: Position[], candles: Candle[], symbol: string, tf: Timeframe): MarkerSpec[] {
  if (candles.length === 0) return []
  const end = candles[candles.length - 1].time + tfSeconds(tf)
  const out: MarkerSpec[] = []
  for (const p of positions) {
    if (p.symbol !== symbol || p.status !== 'closed' || p.closed_at === null || p.exit_price === null) continue
    if (p.closed_at < candles[0].time || p.closed_at >= end) continue // outside the loaded history
    let hit = candles[0]
    for (const c of candles) { if (c.time <= p.closed_at) hit = c; else break }
    const buy = p.side === 'BUY'
    const pnl = p.realized_pnl
    out.push({
      id: `${p.id}:exit`, time: hit.time, position: buy ? 'aboveBar' : 'belowBar', shape: buy ? 'arrowDown' : 'arrowUp',
      color: pnl === null ? COLORS.neutral : pnl >= 0 ? COLORS.up : COLORS.down,
      text: `${EXIT_WORD[p.exit_reason ?? 'manual']} ${fmtPrice(p.exit_price)}`,
    })
  }
  return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}

// ------------------------------------------------------------------- backtests
/** The candle a backtest event belongs to: the last one that opened before it. Entries are stamped at the
 *  close of their signal candle, which is the next candle's open, hence the second back. null = off the loaded chart. */
export function candleAt(candles: Candle[], iso: string, tf: Timeframe): Candle | null {
  const at = Date.parse(iso) / 1000 - 1
  if (candles.length === 0 || !(at >= candles[0].time) || at >= candles[candles.length - 1].time + tfSeconds(tf)) return null
  let hit = candles[0]
  for (const c of candles) { if (c.time <= at) hit = c; else break }
  return hit
}

/** Entry and exit arrows (exit coloured by result) for the backtest's trades on this symbol. */
export function backtestMarkers(trades: BacktestTrade[], open: BacktestOpen[], candles: Candle[], symbol: string, tf: Timeframe): MarkerSpec[] {
  const out: MarkerSpec[] = []
  const entry = (id: string, side: 'BUY' | 'SELL', quantity: number, iso: string, price: number) => {
    const c = candleAt(candles, iso, tf)
    if (c) out.push({ id, time: c.time, position: side === 'BUY' ? 'belowBar' : 'aboveBar', shape: side === 'BUY' ? 'arrowUp' : 'arrowDown', color: side === 'BUY' ? COLORS.up : COLORS.down, text: `${side} ${quantity} @ ${fmtPrice(price)}` })
  }
  trades.forEach((t, i) => {
    if (t.symbol !== symbol) return
    entry(`bt:${i}:in`, t.side, t.quantity, t.entry_time, t.entry_price)
    const c = t.exit_price === null ? null : candleAt(candles, t.exit_time, tf)
    if (c) out.push({ id: `bt:${i}:out`, time: c.time, position: t.side === 'BUY' ? 'aboveBar' : 'belowBar', shape: t.side === 'BUY' ? 'arrowDown' : 'arrowUp', color: t.pnl >= 0 ? COLORS.up : COLORS.down, text: `${EXIT_WORD[t.exit_reason ?? 'manual'] ?? t.exit_reason} ${fmtPrice(t.exit_price!)} ${fmtPnl(t.pnl)}` })
  })
  open.forEach((o, i) => { if (o.symbol === symbol) entry(`bt:open${i}:in`, o.side, o.quantity, o.entry_time, o.entry_price) })
  return out.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}

export type SegmentSpec = { id: string; from: { time: number; price: number }; to: { time: number; price: number }; color: string }
const MAX_SEGMENTS = 300

/** A line from each trade's entry price to its exit price, so the holding period reads at a glance. */
export function backtestSegments(trades: BacktestTrade[], candles: Candle[], symbol: string, tf: Timeframe): SegmentSpec[] {
  const out: SegmentSpec[] = []
  trades.forEach((t, i) => {
    if (t.symbol !== symbol || t.exit_price === null || out.length >= MAX_SEGMENTS) return
    const a = candleAt(candles, t.entry_time, tf), b = candleAt(candles, t.exit_time, tf)
    if (a && b && a.time < b.time) out.push({ id: `bt:${i}`, from: { time: a.time, price: t.entry_price }, to: { time: b.time, price: t.exit_price }, color: t.pnl >= 0 ? COLORS.up : COLORS.down })
  })
  return out
}

// -------------------------------------------------------------------- drawings
export type Anchor = { index: number; price: number }

/** A drawing's anchor points in bar-index space - exactly how the rule engine reads it. */
export function drawingAnchors(d: Drawing, times: number[], tf: Timeframe): Anchor[] {
  if (times.length === 0) return []
  const step = tfSeconds(tf)
  return d.points.map((p) => ({ index: anchorIndex(times, p.time, step), price: p.price }))
}

// ------------------------------------------------------------------ indicators
export type IndicatorLine = {
  key: string
  kind: 'line' | 'histogram'
  color: string
  width: number
  dashed?: boolean
  /** draw as dots with no line (Parabolic SAR) */
  dots?: boolean
  points: { time: number; value: number; color?: string }[]
}
export type IndicatorOutput = { id: string; label: string; pane: 'price' | 'separate'; lines: IndicatorLine[]; levels?: number[] }

/** Guide lines drawn across an oscillator's pane. */
const LEVELS: Partial<Record<string, number[]>> = { rsi: [30, 70], stochastic: [20, 80], cci: [-100, 100], williams_r: [-80, -20], adx: [25], roc: [0] }

const OVERLAY_COLORS = ['#f5a623', '#4fc3f7', '#ba68c8', '#81c784', '#ff8a65', '#9ccc65']

export function indicatorOutputs(configs: IndicatorConfig[], candles: Candle[]): IndicatorOutput[] {
  if (candles.length === 0) return []
  const data = { high: candles.map((c) => c.high), low: candles.map((c) => c.low), close: candles.map((c) => c.close) }
  const points = (values: number[], color?: (i: number) => string | undefined) =>
    values.flatMap((v, i) => (Number.isFinite(v) ? [{ time: candles[i].time, value: v, ...(color ? { color: color(i) } : {}) }] : []))
  return configs.map((cfg, n) => {
    const out = computeIndicator(cfg.name, cfg.params, data)
    const base = OVERLAY_COLORS[n % OVERLAY_COLORS.length]
    const label = indicatorLabel(cfg.name, cfg.params)
    const pane = INDICATORS[cfg.name].pane
    const lines: IndicatorLine[] = []
    switch (cfg.name) {
      case 'bollinger':
      case 'donchian':
      case 'keltner':
        lines.push({ key: 'upper', kind: 'line', color: base, width: 1, points: points(out.upper) })
        lines.push({ key: 'middle', kind: 'line', color: base, width: 1, dashed: true, points: points(out.middle) })
        lines.push({ key: 'lower', kind: 'line', color: base, width: 1, points: points(out.lower) })
        break
      case 'supertrend':
        lines.push({ key: 'line', kind: 'line', color: COLORS.up, width: 2, points: points(out.line, (i) => (out.direction[i] > 0 ? COLORS.up : COLORS.down)) })
        break
      case 'stochastic':
        lines.push({ key: 'k', kind: 'line', color: '#4fc3f7', width: 1, points: points(out.k) })
        lines.push({ key: 'd', kind: 'line', color: '#f5a623', width: 1, points: points(out.d) })
        break
      case 'adx':
        lines.push({ key: 'adx', kind: 'line', color: base, width: 2, points: points(out.adx) })
        lines.push({ key: 'plus_di', kind: 'line', color: COLORS.up, width: 1, points: points(out.plus_di) })
        lines.push({ key: 'minus_di', kind: 'line', color: COLORS.down, width: 1, points: points(out.minus_di) })
        break
      case 'psar':
        lines.push({ key: 'value', kind: 'line', color: base, width: 1, dots: true, points: points(out.value) })
        break
      case 'macd':
        lines.push({ key: 'histogram', kind: 'histogram', color: COLORS.up, width: 1, points: points(out.histogram, (i) => (out.histogram[i] >= 0 ? 'rgba(38,166,154,.55)' : 'rgba(239,83,80,.55)')) })
        lines.push({ key: 'macd', kind: 'line', color: '#4fc3f7', width: 1, points: points(out.macd) })
        lines.push({ key: 'signal', kind: 'line', color: '#f5a623', width: 1, points: points(out.signal) })
        break
      default:
        lines.push({ key: 'value', kind: 'line', color: base, width: 1, points: points(out.value) })
    }
    return { id: cfg.id, label, pane, lines, ...(LEVELS[cfg.name] ? { levels: LEVELS[cfg.name] } : {}) }
  })
}

/** What the chart's indicator series depend on. The chart rebuilds its series only when this changes, so it must
 *  also change when outputs first appear (candles arrive after the indicator list), not just when the list does. */
export function indicatorSignature(outputs: IndicatorOutput[], configKey: string): string {
  return `${configKey}#${outputs.map((o) => `${o.id}:${o.pane}:${o.lines.map((l) => `${l.key}/${l.kind}`).join(',')}`).join(';')}`
}
