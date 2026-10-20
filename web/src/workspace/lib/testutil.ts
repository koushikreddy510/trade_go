import type { Candle } from '../api/types'

/** Unix seconds for a wall-clock time in IST (UTC+5:30). */
export const ist = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - 19800

export const candle = (time: number, o: number, h: number, l: number, c: number, v = 100): Candle => ({ time, open: o, high: h, low: l, close: c, volume: v })
