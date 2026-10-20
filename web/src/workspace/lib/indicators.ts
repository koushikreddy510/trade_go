// TypeScript twin of trading_service/terminal/indicators.py (verified against golden.json).
// Same conventions as TradingView: SMA-seeded EMA, Wilder RSI/ATR, population std for
// Bollinger. Warm-up values are NaN, never a misleading partial number.
import type { IndicatorName } from '../api/types'

export type Series = number[]

export function sma(values: Series, period: number): Series {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: Series, period: number): Series {
  const out = new Array<number>(values.length).fill(NaN)
  const first = values.findIndex((v) => !Number.isNaN(v))
  if (first < 0) return out
  const seed = first + period - 1
  if (seed >= values.length) return out
  let acc = 0
  for (let i = first; i <= seed; i++) acc += values[i]
  out[seed] = acc / period
  const alpha = 2 / (period + 1)
  for (let i = seed + 1; i < values.length; i++) out[i] = alpha * values[i] + (1 - alpha) * out[i - 1]
  return out
}

const rsiFrom = (gain: number, loss: number) => (loss === 0 ? 100 : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss))

export function rsi(values: Series, period = 14): Series {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length <= period) return out
  const gain: number[] = []
  const loss: number[] = []
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    gain.push(d > 0 ? d : 0)
    loss.push(d < 0 ? -d : 0)
  }
  let avgGain = gain.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = loss.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period] = rsiFrom(avgGain, avgLoss)
  for (let i = period; i < gain.length; i++) {
    avgGain = (avgGain * (period - 1) + gain[i]) / period
    avgLoss = (avgLoss * (period - 1) + loss[i]) / period
    out[i + 1] = rsiFrom(avgGain, avgLoss)
  }
  return out
}

export function trueRange(high: Series, low: Series, close: Series): Series {
  return high.map((h, i) => (i === 0 ? h - low[0] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]))))
}

export function atr(high: Series, low: Series, close: Series, period = 14): Series {
  const tr = trueRange(high, low, close)
  const out = new Array<number>(tr.length).fill(NaN)
  if (tr.length < period) return out
  out[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < tr.length; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
  return out
}

export function bollinger(values: Series, period = 20, mult = 2): Record<'upper' | 'middle' | 'lower', Series> {
  const mid = sma(values, period)
  const sd = new Array<number>(values.length).fill(NaN)
  for (let i = period - 1; i < values.length; i++) {
    const mean = mid[i]
    let acc = 0
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - mean) ** 2
    sd[i] = Math.sqrt(acc / period) // population std, like TradingView
  }
  return { upper: mid.map((m, i) => m + mult * sd[i]), middle: mid, lower: mid.map((m, i) => m - mult * sd[i]) }
}

export function macd(values: Series, fast = 12, slow = 26, signal = 9): Record<'macd' | 'signal' | 'histogram', Series> {
  const f = ema(values, fast)
  const s = ema(values, slow)
  const line = f.map((v, i) => v - s[i])
  const sig = ema(line, signal)
  return { macd: line, signal: sig, histogram: line.map((v, i) => v - sig[i]) }
}

export function supertrend(high: Series, low: Series, close: Series, period = 10, multiplier = 3): Record<'line' | 'direction', Series> {
  const a = atr(high, low, close, period)
  const line = new Array<number>(close.length).fill(NaN)
  const direction = new Array<number>(close.length).fill(NaN)
  const start = period - 1
  if (close.length <= start) return { line, direction }
  let finalUpper = 0
  let finalLower = 0
  let trend = 1
  for (let i = start; i < close.length; i++) {
    const hl2 = (high[i] + low[i]) / 2
    const upper = hl2 + multiplier * a[i]
    const lower = hl2 - multiplier * a[i]
    if (i === start) {
      finalUpper = upper
      finalLower = lower
      trend = close[i] >= hl2 ? 1 : -1
    } else {
      const prevUpper = finalUpper
      const prevLower = finalLower
      finalUpper = upper < prevUpper || close[i - 1] > prevUpper ? upper : prevUpper
      finalLower = lower > prevLower || close[i - 1] < prevLower ? lower : prevLower
      if (trend === -1 && close[i] > finalUpper) trend = 1
      else if (trend === 1 && close[i] < finalLower) trend = -1
    }
    line[i] = trend === 1 ? finalLower : finalUpper
    direction[i] = trend
  }
  return { line, direction }
}


// ---- oscillators and channels (high / low / close only) ----------------------------
const rolling = (values: Series, period: number, pick: (w: number[]) => number): Series =>
  values.map((_, i) => (i < period - 1 ? NaN : pick(values.slice(i - period + 1, i + 1))))
const maxOf = (w: number[]) => Math.max(...w)
const minOf = (w: number[]) => Math.min(...w)

/** Wilder's moving average seeded with the simple average of the first `period` valid values (leading NaNs skipped). */
function rma(values: Series, period: number): Series {
  const out = new Array<number>(values.length).fill(NaN)
  const first = values.findIndex((v) => !Number.isNaN(v))
  if (first < 0) return out
  const seed = first + period - 1
  if (seed >= values.length) return out
  let acc = 0
  for (let i = first; i <= seed; i++) acc += values[i]
  out[seed] = acc / period
  for (let i = seed + 1; i < values.length; i++) out[i] = (out[i - 1] * (period - 1) + values[i]) / period
  return out
}

export function stochastic(high: Series, low: Series, close: Series, period = 14, smoothK = 3, smoothD = 3): Record<'k' | 'd', Series> {
  const hh = rolling(high, period, maxOf)
  const ll = rolling(low, period, minOf)
  const raw = close.map((c, i) => (Number.isNaN(hh[i]) ? NaN : hh[i] - ll[i] > 0 ? (100 * (c - ll[i])) / (hh[i] - ll[i]) : 0))
  const k = new Array<number>(close.length).fill(NaN)
  const smoothed = sma(raw.slice(period - 1), smoothK)
  smoothed.forEach((v, i) => { k[period - 1 + i] = v })
  const d = new Array<number>(close.length).fill(NaN)
  const first = period - 1 + smoothK - 1
  if (k.length > first) sma(k.slice(first), smoothD).forEach((v, i) => { d[first + i] = v })
  return { k, d }
}

export function cci(high: Series, low: Series, close: Series, period = 20): Series {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3)
  const mean = sma(tp, period)
  return tp.map((v, i) => {
    if (i < period - 1) return NaN
    let dev = 0
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - mean[i])
    dev /= period
    return dev > 0 ? (v - mean[i]) / (0.015 * dev) : 0
  })
}

export function williamsR(high: Series, low: Series, close: Series, period = 14): Series {
  const hh = rolling(high, period, maxOf)
  const ll = rolling(low, period, minOf)
  return close.map((c, i) => (Number.isNaN(hh[i]) ? NaN : hh[i] - ll[i] > 0 ? (-100 * (hh[i] - c)) / (hh[i] - ll[i]) : 0))
}

export function adx(high: Series, low: Series, close: Series, period = 14): Record<'adx' | 'plus_di' | 'minus_di', Series> {
  const n = close.length
  const nan = () => new Array<number>(n).fill(NaN)
  if (n <= period) return { adx: nan(), plus_di: nan(), minus_di: nan() }
  const plusDm = nan()
  const minusDm = nan()
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1]
    const down = low[i - 1] - low[i]
    plusDm[i] = up > down && up > 0 ? up : 0
    minusDm[i] = down > up && down > 0 ? down : 0
  }
  const tr = rma(trueRange(high, low, close), period)
  const plus = rma(plusDm, period).map((v, i) => (100 * v) / tr[i])
  const minus = rma(minusDm, period).map((v, i) => (100 * v) / tr[i])
  const dx = plus.map((p, i) => (Number.isNaN(p) || Number.isNaN(minus[i]) ? NaN : p + minus[i] > 0 ? (100 * Math.abs(p - minus[i])) / (p + minus[i]) : 0))
  return { adx: rma(dx, period), plus_di: plus, minus_di: minus }
}

export function donchian(high: Series, low: Series, period = 20): Record<'upper' | 'middle' | 'lower', Series> {
  const upper = rolling(high, period, maxOf)
  const lower = rolling(low, period, minOf)
  return { upper, middle: upper.map((u, i) => (u + lower[i]) / 2), lower }
}

export function keltner(high: Series, low: Series, close: Series, period = 20, atrPeriod = 10, mult = 2): Record<'upper' | 'middle' | 'lower', Series> {
  const mid = ema(close, period)
  const band = atr(high, low, close, atrPeriod).map((a) => mult * a)
  return { upper: mid.map((m, i) => m + band[i]), middle: mid, lower: mid.map((m, i) => m - band[i]) }
}

export function roc(close: Series, period = 12): Series {
  return close.map((c, i) => (i < period || close[i - period] === 0 ? NaN : (100 * (c - close[i - period])) / close[i - period]))
}

/** Parabolic SAR, a port of TradingView's ta.sar (the first bar has no value). */
export function psar(high: Series, low: Series, close: Series, step = 0.02, maxStep = 0.2): Series {
  const out = new Array<number>(close.length).fill(NaN)
  let result = 0
  let maxMin = 0
  let accel = 0
  let below = false
  for (let i = 1; i < close.length; i++) {
    let firstTrendBar = false
    if (i === 1) {
      if (close[1] > close[0]) { below = true; maxMin = high[1]; result = low[0] } else { below = false; maxMin = low[1]; result = high[0] }
      firstTrendBar = true
      accel = step
    }
    result = result + accel * (maxMin - result)
    if (below) {
      if (result > low[i]) { firstTrendBar = true; below = false; result = Math.max(high[i], maxMin); maxMin = low[i]; accel = step }
    } else if (result < high[i]) {
      firstTrendBar = true; below = true; result = Math.min(low[i], maxMin); maxMin = high[i]; accel = step
    }
    if (!firstTrendBar) {
      if (below && high[i] > maxMin) { maxMin = high[i]; accel = Math.min(accel + step, maxStep) }
      else if (!below && low[i] < maxMin) { maxMin = low[i]; accel = Math.min(accel + step, maxStep) }
    }
    if (below) {
      result = Math.min(result, low[i - 1])
      if (i > 1) result = Math.min(result, low[i - 2])
    } else {
      result = Math.max(result, high[i - 1])
      if (i > 1) result = Math.max(result, high[i - 2])
    }
    out[i] = result
  }
  return out
}

// ---- registry (mirrors SPECS in indicators.py) -----------------------------
export type IndicatorSpec = { defaults: Record<string, number>; outputs: string[]; pane: 'price' | 'separate'; label: string }
export const INDICATORS: Record<IndicatorName, IndicatorSpec> = {
  sma: { defaults: { period: 20 }, outputs: ['value'], pane: 'price', label: 'SMA' },
  ema: { defaults: { period: 20 }, outputs: ['value'], pane: 'price', label: 'EMA' },
  rsi: { defaults: { period: 14 }, outputs: ['value'], pane: 'separate', label: 'RSI' },
  atr: { defaults: { period: 14 }, outputs: ['value'], pane: 'separate', label: 'ATR' },
  bollinger: { defaults: { period: 20, mult: 2 }, outputs: ['middle', 'upper', 'lower'], pane: 'price', label: 'Bollinger Bands' },
  macd: { defaults: { fast: 12, slow: 26, signal: 9 }, outputs: ['macd', 'signal', 'histogram'], pane: 'separate', label: 'MACD' },
  supertrend: { defaults: { period: 10, multiplier: 3 }, outputs: ['line', 'direction'], pane: 'price', label: 'Supertrend' },
  stochastic: { defaults: { period: 14, smooth_k: 3, smooth_d: 3 }, outputs: ['k', 'd'], pane: 'separate', label: 'Stochastic' },
  cci: { defaults: { period: 20 }, outputs: ['value'], pane: 'separate', label: 'CCI' },
  williams_r: { defaults: { period: 14 }, outputs: ['value'], pane: 'separate', label: 'Williams %R' },
  adx: { defaults: { period: 14 }, outputs: ['adx', 'plus_di', 'minus_di'], pane: 'separate', label: 'ADX' },
  donchian: { defaults: { period: 20 }, outputs: ['middle', 'upper', 'lower'], pane: 'price', label: 'Donchian Channel' },
  keltner: { defaults: { period: 20, atr_period: 10, mult: 2 }, outputs: ['middle', 'upper', 'lower'], pane: 'price', label: 'Keltner Channel' },
  roc: { defaults: { period: 12 }, outputs: ['value'], pane: 'separate', label: 'ROC' },
  psar: { defaults: { step: 0.02, max_step: 0.2 }, outputs: ['value'], pane: 'price', label: 'Parabolic SAR' },
}

export type OHLC = { high: Series; low: Series; close: Series }

export function computeIndicator(name: IndicatorName, params: Record<string, number>, d: OHLC): Record<string, Series> {
  const p = { ...INDICATORS[name].defaults, ...params }
  switch (name) {
    case 'sma': return { value: sma(d.close, p.period) }
    case 'ema': return { value: ema(d.close, p.period) }
    case 'rsi': return { value: rsi(d.close, p.period) }
    case 'atr': return { value: atr(d.high, d.low, d.close, p.period) }
    case 'bollinger': return bollinger(d.close, p.period, p.mult)
    case 'macd': return macd(d.close, p.fast, p.slow, p.signal)
    case 'supertrend': return supertrend(d.high, d.low, d.close, p.period, p.multiplier)
    case 'stochastic': return stochastic(d.high, d.low, d.close, p.period, p.smooth_k, p.smooth_d)
    case 'cci': return { value: cci(d.high, d.low, d.close, p.period) }
    case 'williams_r': return { value: williamsR(d.high, d.low, d.close, p.period) }
    case 'adx': return adx(d.high, d.low, d.close, p.period)
    case 'donchian': return donchian(d.high, d.low, p.period)
    case 'keltner': return keltner(d.high, d.low, d.close, p.period, p.atr_period, p.mult)
    case 'roc': return { value: roc(d.close, p.period) }
    case 'psar': return { value: psar(d.high, d.low, d.close, p.step, p.max_step) }
  }
}

/** "EMA 20", "MACD 12/26/9", "Bollinger Bands 20, 2" - the label shown on the chart. */
export function indicatorLabel(name: IndicatorName, params: Record<string, number>): string {
  const p = { ...INDICATORS[name].defaults, ...params }
  const values = Object.keys(INDICATORS[name].defaults).map((k) => p[k])
  return `${INDICATORS[name].label} ${name === 'macd' ? values.join('/') : values.join(', ')}`
}
