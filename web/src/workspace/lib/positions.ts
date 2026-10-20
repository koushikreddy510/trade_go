import type { Position, Quote } from '../api/types'

/** Profit/loss of an open position at the latest known price (null until a price arrives). */
export function livePnl(p: Position, quote?: Quote): number | null {
  const price = quote?.price ?? p.last_price
  if (price === undefined) return null
  return (price - p.entry_price) * (p.side === 'BUY' ? 1 : -1) * p.quantity
}

/** How far the price is from the stop and the target, as % of the price: how close the trade is to ending. */
export function distanceToExit(p: Position, price: number | undefined): { stopPct: number | null; targetPct: number | null } {
  if (price === undefined || price === 0) return { stopPct: null, targetPct: null }
  const to = (level: number | null) => (level === null ? null : (Math.abs(price - level) / price) * 100)
  return { stopPct: to(p.stop), targetPct: to(p.target) }
}

export function totalPnl(positions: Position[], quotes: Record<string, Quote>): { total: number; known: number } {
  let total = 0
  let known = 0
  for (const p of positions) {
    const v = livePnl(p, quotes[p.symbol])
    if (v !== null) { total += v; known++ }
  }
  return { total, known }
}
