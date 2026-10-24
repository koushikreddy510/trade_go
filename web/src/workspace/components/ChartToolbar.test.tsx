import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChartToolbar } from './ChartToolbar'
import { SBIN, makeApp, quote, renderIn } from './testharness'

describe('ChartToolbar', () => {
  it('shows the symbol with its live price and change', () => {
    renderIn(<ChartToolbar />, makeApp({}, { quotes: { [SBIN]: quote(SBIN, 102) } }))
    expect(screen.getByText('SBIN')).toBeInTheDocument()
    expect(screen.getByText('102.00')).toBeInTheDocument()
    expect(screen.getByText('+2.00%')).toBeInTheDocument()
  })

  it('shows only the current timeframe in a dropdown and switches it, reloading candles', async () => {
    const app = makeApp()
    renderIn(<ChartToolbar />, app)
    const select = screen.getByRole('combobox', { name: 'Timeframe' })
    expect(select).toHaveValue('1H')
    expect(screen.queryByRole('button', { name: '15m' })).toBeNull()          // no row of buttons
    await userEvent.selectOptions(select, '15m')
    await waitFor(() => expect(app.api.candles).toHaveBeenCalledWith(SBIN, '15m'))
    expect(select).toHaveValue('15m')
  })

  it('offers every timeframe the server supports in the dropdown', () => {
    renderIn(<ChartToolbar />, makeApp())
    const names = within(screen.getByRole('combobox', { name: 'Timeframe' })).getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(['1m', '5m', '15m', '30m', '1H', '2H', '4H', '1D', '1W'])
  })

  it('the Indicator menu lists what is applied, with remove', async () => {
    const app = makeApp()
    renderIn(<ChartToolbar />, app)
    await userEvent.click(screen.getByRole('button', { name: '+ Indicator' }))
    expect(screen.getByText('Applied')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove EMA 20' }))
    expect(app.store.get().indicators.some((i) => i.id === 'ema-20')).toBe(false)
  })

  it('adds several indicators from the menu and removes one from the applied list', async () => {
    const app = makeApp()
    renderIn(<ChartToolbar />, app)
    const defaults = app.store.get().indicators.map((x) => x.name)
    await userEvent.click(screen.getByRole('button', { name: '+ Indicator' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^RSI/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))                 // the parameter editor
    await userEvent.click(screen.getByRole('button', { name: '+ Indicator' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^Bollinger/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(app.store.get().indicators.map((x) => x.name)).toEqual([...defaults, 'rsi', 'bollinger'])
    await userEvent.click(screen.getByRole('button', { name: '+ Indicator' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove EMA 20' }))
    expect(app.store.get().indicators.some((x) => x.id === 'ema-20')).toBe(false)
  })

  it('does not add the same indicator twice', async () => {
    const app = makeApp()
    renderIn(<ChartToolbar />, app)
    const before = app.store.get().indicators.length
    await userEvent.click(screen.getByRole('button', { name: '+ Indicator' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^EMA/ }))   // the default EMA 20 is already there
    expect(app.store.get().indicators).toHaveLength(before)
  })
})
