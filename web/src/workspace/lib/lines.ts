// TypeScript twin of the line maths in trading_service/terminal/drawings.py.
//
// A drawn line is stored as (unix time, price) anchors. The rule engine evaluates it in
// BAR-INDEX space (so a line looks and evaluates the same across overnight/weekend
// gaps); the chart must draw it the same way, which is what these helpers do.
import type { Drawing, Edge } from '../api/types'

/** Map a time onto the bar axis of `times` (ascending bar-open epochs). */
export function anchorIndex(times: number[], t: number, step: number): number {
  const n = times.length
  if (n === 0) throw new Error('no bars')
  if (t <= times[0]) return (t - times[0]) / step
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  return lo + (t - times[lo]) / (times[lo + 1] - times[lo])
}

/** Inverse of anchorIndex: the time at (fractional) bar index `index`. */
export function indexToTime(times: number[], index: number, step: number): number {
  const n = times.length
  if (n === 0) throw new Error('no bars')
  if (index <= 0) return times[0] + index * step
  if (index >= n - 1) return times[n - 1] + (index - (n - 1)) * step
  const i = Math.floor(index)
  return times[i] + (index - i) * (times[i + 1] - times[i])
}

export function lineValueAt(d: Pick<Drawing, 'kind' | 'points'>, times: number[], index: number, step: number, edge?: Edge): number | null {
  if (d.kind === 'horizontal_line') return d.points[0].price
  if (d.kind === 'rectangle') {
    const prices = d.points.map((p) => p.price)
    return edge === 'top' ? Math.max(...prices) : edge === 'bottom' ? Math.min(...prices) : null
  }
  if (d.kind === 'text') return null
  const [p1, p2] = d.points
  const i1 = anchorIndex(times, p1.time, step)
  const i2 = anchorIndex(times, p2.time, step)
  if (i1 === i2) return null
  const slope = (p2.price - p1.price) / (i2 - i1)
  return p1.price + slope * (index - i1)
}

export function lineSeries(d: Pick<Drawing, 'kind' | 'points'>, times: number[], step: number, edge?: Edge): (number | null)[] {
  return times.map((_, i) => lineValueAt(d, times, i, step, edge))
}

/** Pixel distance from point P to the segment A-B (used to pick a line with the mouse). */
export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
