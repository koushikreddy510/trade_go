import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TriggersPanel } from './TriggersPanel'
import { makeApp, renderIn } from './testharness'

const LINE = { id: 'L1', symbol: 'MCX:GOLDPETAL30OCT26', kind: 'horizontal_line', points: [{ time: 1, price: 14536 }], style: {}, label: 'Day low' }
const RAY = { id: 'R1', symbol: 'MCX:SILVERMIC30NOV26', kind: 'ray', points: [{ time: 1, price: 210000 }, { time: 2, price: 210000 }], style: {}, label: '' }
const RULE = {
  id: 'r1', symbol: 'MCX:GOLDPETAL30OCT26', timeframe: '15m', side: 'SELL', quantity: 2, name: 'sell below day low', enabled: true, once: true,
  execution: { account: 'flattrade', product: 'I' },
  condition: { type: 'cross', direction: 'below', a: { kind: 'close' }, b: { kind: 'line', drawing_id: 'L1' } },
  stop: { type: 'candle', buffer_pct: 0.05 }, target: { type: 'rr', ratio: 3 }, trail: { type: 'candle', bars: 1, timeframe: '5m' },
  exit_condition: null, exit_timeframe: null, exit_condition_2: null, exit_timeframe_2: null,
}

describe('TriggersPanel', () => {
  it('shows, for each line, the rules that act on it and says when a line is only a drawing', async () => {
    const app = makeApp()
    app.api.allDrawings.mockResolvedValue([LINE, RAY])
    app.api.rulesWatch.mockResolvedValue([{
      rule: RULE, live: 14548, session_open: true, last_candle: 1, next_check: null, positions: [],
      plan: { stop: 'signal candle high + 0.05%', trail: 'after each completed 5m candle: …', target: '3R', entry_if_now: 14544, stop_if_now: 14553.27, target_if_now: 14516.2 },
      entry: { type: 'cross', label: 'close crosses below line', met: false, a: 14544, b: 14536, distance: 8, distance_pct: 0.06 },
    }])
    renderIn(<TriggersPanel />, app)
    expect(await screen.findByText('Sell 2')).toBeInTheDocument()
    expect(screen.getByText('LIVE Intraday')).toBeInTheDocument()
    expect(screen.getByText(/uses the line for entry/)).toBeInTheDocument()
    expect(screen.getByText(/stop: signal candle high \+ 0.05% \(≈ 14,553.27 if it fired now\)/)).toBeInTheDocument()
    expect(screen.getByText(/waiting · 0.06% away/)).toBeInTheDocument()
    expect(screen.getByText('drawing only: no rule acts on it')).toBeInTheDocument()
  })
})
