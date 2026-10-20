// The TypeScript twin of drawings.line_value_at: zones are flat levels, notes have no price.
import { describe, expect, it } from 'vitest'
import { lineSeries, lineValueAt } from './lines'

const times = [0, 3600, 7200, 10800]
const zone = { kind: 'rectangle' as const, points: [{ time: 7200, price: 98 }, { time: 0, price: 104 }] }

describe('zones and notes as levels', () => {
  it('a zone gives its top or bottom whichever corner was clicked first', () => {
    expect(lineSeries(zone, times, 3600, 'top')).toEqual([104, 104, 104, 104])
    expect(lineValueAt(zone, times, 9, 3600, 'bottom')).toBe(98) // and beyond the last bar
  })
  it('a zone with no edge chosen has no price', () => {
    expect(lineValueAt(zone, times, 1, 3600)).toBeNull()
  })
  it('a note never has a price', () => {
    expect(lineValueAt({ kind: 'text', points: [{ time: 0, price: 100 }] }, times, 1, 3600, 'top')).toBeNull()
  })
})
