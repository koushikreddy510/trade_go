import { describe, expect, it } from 'vitest'
import type { Drawing } from '../api/types'
import { DrawingsPrimitive, hexAlpha } from './DrawingsPrimitive'

const d = (kind: Drawing['kind'], points: [number, number][], label = ''): Drawing => ({ id: 'x', symbol: 'NSE:SBIN-EQ', kind, points: points.map(([time, price]) => ({ time, price })), style: {}, label })

describe('hexAlpha', () => {
  it('turns a hex colour into a see-through one for zone fills', () => {
    expect(hexAlpha('#26a69a', 0.14)).toBe('rgba(38,166,154,0.14)')
    expect(hexAlpha('#F7B955', 1)).toBe('rgba(247,185,85,1)')
  })
  it('leaves anything else alone', () => {
    expect(hexAlpha('red', 0.5)).toBe('red')
    expect(hexAlpha('#abc', 0.5)).toBe('#abc')
  })
})

describe('describing a drawing in the list', () => {
  it('names zones by their price range whichever corner came first', () => {
    expect(DrawingsPrimitive.describe(d('rectangle', [[1, 110], [2, 98]]))).toBe('Zone 98.00 – 110.00')
  })
  it('places a note at its price', () => {
    expect(DrawingsPrimitive.describe(d('text', [[1, 101.5]]))).toBe('Note at 101.50')
  })
  it('still describes lines', () => {
    expect(DrawingsPrimitive.describe(d('horizontal_line', [[1, 100]]))).toBe('Horizontal line at 100.00')
    expect(DrawingsPrimitive.describe(d('trend_line', [[1, 90], [2, 95]]))).toBe('Trend line 90.00 → 95.00')
  })
})
