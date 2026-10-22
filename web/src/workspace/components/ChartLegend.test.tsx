import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartLegend } from './ChartLegend'
import { makeApp, renderIn } from './testharness'

const LEGEND = {
  time: 1, open: '11.58', high: '11.60', low: '11.57', close: '11.60', volume: '7.38L', change: '+0.02 (+0.17%)', tone: 'up' as const,
  indicators: [
    { id: 'ema-20', label: 'EMA 20', values: [{ key: 'v', text: '11.71', color: '#f5a623' }] },
    { id: 'fund:pe', label: 'P/E (TTM)', values: [{ key: 'pe', text: '12.1', color: '#888' }] },
  ],
}

describe('ChartLegend', () => {
  it('hides, opens settings for and removes an indicator from its legend row', () => {
    const app = makeApp({}, { indicators: [{ id: 'ema-20', name: 'ema', params: { period: 20 } }] as never })
    renderIn(<ChartLegend symbol="NSE:IDEA-EQ" timeframe="15m" legend={LEGEND} />, app)
    fireEvent.click(screen.getByLabelText('Hide EMA 20'))
    expect(app.store.get().indicators[0].hidden).toBe(true)
    fireEvent.click(screen.getByLabelText('Settings of EMA 20'))
    expect(app.store.get().editingIndicator).toBe('ema-20')
    fireEvent.click(screen.getByLabelText('Remove EMA 20'))
    expect(app.store.get().indicators).toEqual([])
    expect(screen.queryByLabelText('Remove P/E (TTM)')).not.toBeInTheDocument()     // the P/E pane is toggled from the toolbar
  })

  it('keeps a hidden indicator as a greyed row without values', () => {
    renderIn(<ChartLegend symbol="NSE:IDEA-EQ" timeframe="15m" legend={LEGEND} hidden={new Set(['ema-20'])} />, makeApp())
    expect(screen.getByTestId('legend-ema-20')).toHaveClass('off')
    expect(screen.queryByText('11.71')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show EMA 20')).toBeInTheDocument()
  })
})
