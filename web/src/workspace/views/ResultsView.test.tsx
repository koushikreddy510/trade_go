import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeApp, recent, renderIn } from '../components/testharness'
import { ResultsView } from './ResultsView'

describe('ResultsView (latest quarterly results)', () => {
  it('lists companies that reported recently with their growth, coloured', async () => {
    const app = makeApp({ recentResults: async () => [recent('NSE:INFY-EQ'), recent('NSE:TCS-EQ', { revenue_growth_pct: -2, profit_growth_pct: 15, net_profit: null })] })
    renderIn(<ResultsView />, app)
    const infy = (await screen.findByText('INFY')).closest('tr')!
    expect(within(infy).getByText('+8.0%')).toHaveClass('up')
    expect(within(infy).getByText('-12.0%')).toHaveClass('down')
    const tcs = screen.getByText('TCS').closest('tr')!
    expect(within(tcs).getByText('-2.0%')).toHaveClass('down')
    expect(within(tcs).getAllByText('—').length).toBeGreaterThan(0) // missing net profit
  })

  it('asks for the last 7 days first and re-asks for another period', async () => {
    const app = makeApp()
    renderIn(<ResultsView />, app)
    await screen.findByText('INFY')
    expect(app.api.recentResults).toHaveBeenLastCalledWith(7)
    await userEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await waitFor(() => expect(app.api.recentResults).toHaveBeenLastCalledWith(30))
  })

  it('opens a company’s chart with its financials in the dock', async () => {
    const app = makeApp({}, { view: 'results' })
    renderIn(<ResultsView />, app)
    await userEvent.click(await screen.findByRole('button', { name: 'INFY' }))
    await waitFor(() => expect(app.store.get()).toMatchObject({ view: 'chart', symbol: 'NSE:INFY-EQ', dock: 'financials' }))
  })

  it('explains an empty period', async () => {
    renderIn(<ResultsView />, makeApp({ recentResults: async () => [] }))
    expect(await screen.findByText(/No results announced in the last 7 days/)).toBeInTheDocument()
  })

  it('shows an error instead of loading forever', async () => {
    renderIn(<ResultsView />, makeApp({ recentResults: async () => { throw new Error('boom') } }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
