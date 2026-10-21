import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RuleWatch } from './RuleWatch'
import { makeApp, renderIn } from './testharness'

const ROW = {
  rule: { id: 'r1', symbol: 'MCX:GOLDPETAL30OCT26', timeframe: '15m', side: 'SELL', quantity: 2, name: 'sell below day low', enabled: true,
    execution: { account: 'flattrade', product: 'I' } },
  live: 14530, session_open: true, last_candle: 1, next_check: Math.floor(Date.now() / 1000) + 125, positions: [],
  entry: { type: 'cross', label: 'close crosses below line', met: false, a: 14538, b: 14536, a_live: 14530, side: 'below', distance: -6,
    distance_pct: 0, on_trigger_side: true },
}

describe('RuleWatch', () => {
  it('shows each rule with its condition, values, live state and the next check', async () => {
    const app = makeApp()
    app.api.rulesWatch.mockResolvedValue([ROW])
    renderIn(<RuleWatch />, app)
    expect(await screen.findByText(/close crosses below line/)).toBeInTheDocument()
    expect(screen.getByText(/now 14,530.00 vs 14,536.00/)).toBeInTheDocument()
    expect(screen.getByText(/waiting for the candle to close/)).toBeInTheDocument()
    expect(screen.getByText('LIVE Intraday')).toBeInTheDocument()
    expect(screen.getByText(/next check 2:0\d/)).toBeInTheDocument()
  })

  it('says how far a condition still has to move', async () => {
    const app = makeApp()
    app.api.rulesWatch.mockResolvedValue([{ ...ROW, entry: { ...ROW.entry, a_live: null, distance: 2, distance_pct: 0.014, on_trigger_side: false } }])
    renderIn(<RuleWatch />, app)
    expect(await screen.findByText(/needs −2.00 \(0.01%\)/)).toBeInTheDocument()
  })
})
