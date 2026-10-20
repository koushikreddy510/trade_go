// Live positions: P&L follows the broker's prices, and closing works.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PositionsPanel } from './PositionsPanel'
import { SBIN, TCS, T0, makeApp, position, quote, renderIn } from './testharness'

describe('PositionsPanel', () => {
  it('explains how a position appears when there are none', () => {
    renderIn(<PositionsPanel />, makeApp())
    expect(screen.getByText(/No open positions/)).toBeInTheDocument()
  })

  it('shows entry, stop and target, and the profit at the latest price', () => {
    const app = makeApp({}, { positions: { open: [position()], closed: [] }, quotes: { [SBIN]: quote(SBIN, 103) } })
    renderIn(<PositionsPanel />, app)
    const row = screen.getByText('SBIN').closest('tr')!
    expect(within(row).getByText('100.00')).toBeInTheDocument() // entry
    expect(within(row).getByText('95.00')).toBeInTheDocument()  // stop
    expect(within(row).getByText('110.00')).toBeInTheDocument() // target
    expect(screen.getByTestId('pnl-p1')).toHaveTextContent('+30.00') // (103-100) x 10
    expect(screen.getByTestId('pnl-p1')).toHaveClass('up')
  })

  it('updates the profit as new ticks arrive', async () => {
    const app = makeApp({}, { positions: { open: [position()], closed: [] }, quotes: { [SBIN]: quote(SBIN, 103) } })
    renderIn(<PositionsPanel />, app)
    app.ctl.onMessage({ type: 'tick', quote: quote(SBIN, 97) })
    await waitFor(() => expect(screen.getByTestId('pnl-p1')).toHaveTextContent('-30.00'))
    expect(screen.getByTestId('pnl-p1')).toHaveClass('down')
  })

  it('a short position gains when the price falls', () => {
    const app = makeApp({}, { positions: { open: [position({ side: 'SELL' })], closed: [] }, quotes: { [SBIN]: quote(SBIN, 96) } })
    renderIn(<PositionsPanel />, app)
    expect(screen.getByTestId('pnl-p1')).toHaveTextContent('+40.00')
  })

  it('totals open profit across symbols and flags when some have no price yet', () => {
    const app = makeApp({}, {
      positions: { open: [position(), position({ id: 'p2', symbol: TCS })], closed: [] },
      quotes: { [SBIN]: quote(SBIN, 102) },
    })
    renderIn(<PositionsPanel />, app)
    expect(screen.getByTestId('total-pnl')).toHaveTextContent('+20.00 (partial)')
  })

  it('cannot close a position that has no price yet', () => {
    const app = makeApp({}, { positions: { open: [position()], closed: [] } })
    renderIn(<PositionsPanel />, app)
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  })

  it('closes a position at the latest price and moves it to the closed list', async () => {
    const app = makeApp({}, { positions: { open: [position()], closed: [] }, quotes: { [SBIN]: quote(SBIN, 104) } })
    renderIn(<PositionsPanel />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(app.api.closePosition).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('manual')).toBeInTheDocument()
    expect(screen.getByText('+40.00')).toBeInTheDocument()
    expect(screen.getByText(/No open positions/)).toBeInTheDocument()
  })

  it('marks a trailing stop and explains it on hover', () => {
    const p = position({ stop: 101, initial_stop: 99, trail: { type: 'pct', value: 1 } })
    renderIn(<PositionsPanel />, makeApp({}, { positions: { open: [p], closed: [] } }))
    const cell = screen.getByText(/101\.00 ↗/)
    expect(cell).toHaveAttribute('title', expect.stringContaining('trail 1% from the close'))
    expect(cell).toHaveAttribute('title', expect.stringContaining('started at 99.00'))
  })

  it('says a trade ended on its exit rule', () => {
    const closed = position({ id: 'c2', status: 'closed', exit_reason: 'exit_rule', exit_price: 105, realized_pnl: 50, closed_at: T0 + 600 })
    renderIn(<PositionsPanel />, makeApp({}, { positions: { open: [], closed: [closed] } }))
    expect(screen.getByText('exit rule')).toBeInTheDocument()
  })

  it('lists closed trades with why they ended', () => {
    const closed = position({ id: 'c1', status: 'closed', exit_reason: 'stop', exit_price: 95, realized_pnl: -50, closed_at: T0 + 600 })
    renderIn(<PositionsPanel />, makeApp({}, { positions: { open: [], closed: [closed] } }))
    const row = screen.getByText('stop').closest('tr')!
    expect(within(row).getByText('-50.00')).toHaveClass('down')
  })
})
