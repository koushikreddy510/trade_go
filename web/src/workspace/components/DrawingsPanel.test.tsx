import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DrawingsPanel } from './DrawingsPanel'
import { makeApp, renderIn } from './testharness'

const LINE = { id: 'L1', symbol: 'NSE:SBIN-EQ', kind: 'horizontal_line', points: [{ time: 1, price: 14536 }], style: {}, label: 'Day low' }
const RULE = {
  id: 'r1', symbol: 'NSE:SBIN-EQ', timeframe: '15m', side: 'SELL', quantity: 2, name: 'sell below day low', enabled: true, once: true,
  execution: { account: 'flattrade', product: 'I' },
  condition: { type: 'cross', direction: 'below', a: { kind: 'close' }, b: { kind: 'line', drawing_id: 'L1' } },
  stop: { type: 'candle', buffer_pct: 0.05 }, target: null, trail: null,
  exit_condition: null, exit_timeframe: null, exit_condition_2: null, exit_timeframe_2: null,
}

describe('DrawingsPanel', () => {
  it('shows on each line the rules using it: direction, size, live, stop-loss and trailing', async () => {
    const app = makeApp({}, { drawings: [LINE] as never })
    app.api.rulesWatch.mockResolvedValue([{ rule: RULE, live: 14548, session_open: true, last_candle: 1, next_check: null, positions: [],
      plan: { stop: 'signal candle high + 0.05%', trail: null, target: null, entry_if_now: 14544, stop_if_now: 14553.27, target_if_now: null },
      entry: { type: 'cross', label: 'close crosses below line', met: false, a: 14544, b: 14536, distance: 8, distance_pct: 0.06 } }])
    renderIn(<DrawingsPanel />, app)
    expect(await screen.findByText('Sell 2')).toBeInTheDocument()
    expect(screen.getByText('LIVE Intraday')).toBeInTheDocument()
    expect(screen.getByText(/signal candle high \+ 0.05% \(≈ 14,553.27 if it fired now\)/)).toBeInTheDocument()
    expect(screen.getByText('none')).toBeInTheDocument()                                   // no trailing
  })

  it('says when a line is only a drawing', async () => {
    renderIn(<DrawingsPanel />, makeApp({}, { drawings: [LINE] as never }))
    expect(await screen.findByText('Drawing only: no rule acts on this line.')).toBeInTheDocument()
  })
})
