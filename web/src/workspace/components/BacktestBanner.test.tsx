import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BacktestBanner } from './BacktestBanner'
import { SBIN, btReport, makeApp, renderIn } from './testharness'

const overlay = (focus: number | null = null) => ({ label: 'Oct → Nov', open: [], focus, trades: [...btReport().trades, { ...btReport().trades[0], entry_time: '2025-10-05T09:45:00+00:00', pnl: -500 }] })

describe('BacktestBanner', () => {
  it('is absent when no backtest is on the chart', () => {
    renderIn(<BacktestBanner />, makeApp())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('counts this symbol’s trades and their net result', () => {
    renderIn(<BacktestBanner />, makeApp({}, { btOverlay: overlay() }))
    const b = screen.getByRole('status')
    expect(b).toHaveTextContent('Backtest Oct → Nov')
    expect(b).toHaveTextContent('2 trades') // SBIN has two of the three
    expect(b).toHaveTextContent('+8,500.00')
  })

  it('steps through the trades, wrapping round at both ends', async () => {
    const app = makeApp({}, { btOverlay: overlay() })
    renderIn(<BacktestBanner />, app)
    const focus = () => app.store.get().btOverlay!.focus
    await userEvent.click(screen.getByRole('button', { name: 'Next trade' }))
    expect(focus()).toBe(Date.parse('2025-10-01T09:45:00+00:00') / 1000)
    await userEvent.click(screen.getByRole('button', { name: 'Next trade' }))
    expect(focus()).toBe(Date.parse('2025-10-05T09:45:00+00:00') / 1000)
    await userEvent.click(screen.getByRole('button', { name: 'Next trade' }))
    expect(focus()).toBe(Date.parse('2025-10-01T09:45:00+00:00') / 1000)
    await userEvent.click(screen.getByRole('button', { name: 'Previous trade' }))
    expect(focus()).toBe(Date.parse('2025-10-05T09:45:00+00:00') / 1000)
  })

  it('hides itself and the trades', async () => {
    const app = makeApp({}, { btOverlay: overlay(), symbol: SBIN })
    renderIn(<BacktestBanner />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(app.store.get().btOverlay).toBeNull()
  })
})
