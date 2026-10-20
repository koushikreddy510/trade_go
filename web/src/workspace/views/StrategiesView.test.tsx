// Strategy screener -> watchlist: choose a strategy and a tolerance, preview matched + near-miss stocks, sync them.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { SBIN, TCS, candidate, makeApp, renderIn, syncLink, syncPlan, syncResult, syncStrategy, wl } from '../components/testharness'
import { StrategiesView } from './StrategiesView'

const lists = { watchlists: [wl('w1', 'Watchlist', [SBIN])], activeWatchlistId: 'w1' }
const field = (name: RegExp | string) => screen.getByRole('spinbutton', { name })
const strategyPicker = () => screen.getByRole('combobox', { name: 'Strategy' })

describe('StrategiesView', () => {
  it('lists the screener strategies and spells out the selected strategy’s conditions', async () => {
    const app = makeApp({ syncStrategies: async () => [syncStrategy(), syncStrategy({ id: 8, name: 'Breakout', conditions: ['CLOSE > 100'] })] }, lists)
    renderIn(<StrategiesView />, app)
    expect(await screen.findByRole('option', { name: 'Momentum' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Breakout' })).toBeInTheDocument()
    const conditions = screen.getByLabelText('Strategy conditions')
    expect(within(conditions).getByText('RSI(14) > 60')).toBeInTheDocument()
    expect(within(conditions).getByText('EMA(20) < close')).toBeInTheDocument()
    await userEvent.selectOptions(strategyPicker(), '8')
    expect(within(screen.getByLabelText('Strategy conditions')).getByText('CLOSE > 100')).toBeInTheDocument()
  })

  it('prefers an active strategy as the default choice', async () => {
    const app = makeApp({ syncStrategies: async () => [syncStrategy({ id: 1, name: 'Old', is_active: false }), syncStrategy({ id: 2, name: 'Live' })] }, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Live' })
    expect(strategyPicker()).toHaveValue('2')
  })

  it('previews with the chosen tolerance and shows matched stocks and near-misses with why', async () => {
    const app = makeApp({}, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.clear(field(/tolerance/i))
    await userEvent.type(field(/tolerance/i), '2.5')
    await userEvent.selectOptions(screen.getByLabelText(/may be missed/i), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(app.api.syncPreview).toHaveBeenCalledWith({ strategy_id: 7, tolerance_pct: 2.5, max_failing: 2, max_symbols: 100, filters: [] }))
    const table = await screen.findByLabelText('Preview')
    expect(within(table).getByText('1 matched · 1 near-miss · 1800 stocks scanned · data of 2026-10-16')).toBeInTheDocument()
    const tcs = within(table).getByText('TCS').closest('tr')!
    expect(within(tcs).getByText('Near')).toBeInTheDocument()
    expect(within(tcs).getByText('1.7%')).toBeInTheDocument()
    expect(within(tcs).getByText('RSI(14) 59 is 1.7% below 60')).toBeInTheDocument()
    expect(within(within(table).getByText('SBIN').closest('tr')!).getByText('Matched')).toBeInTheDocument()
    expect(app.api.syncApply).not.toHaveBeenCalled()         // previewing never writes
  })

  it('says so when nothing qualifies, and how many were dropped by financial filters or capped', async () => {
    const app = makeApp({ syncPreview: async () => syncPlan({ candidates: [], matched_total: 0, near_total: 0 }) }, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/Nothing qualifies right now/)).toBeInTheDocument()
  })

  it('reports financial-filter rejections and truncation in the summary line', async () => {
    const app = makeApp({ syncPreview: async () => syncPlan({ rejected_by_financials: 4, truncated: true, max_symbols: 50 }) }, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByText(/4 dropped by financial filters · list capped at 50/)).toBeInTheDocument()
  })

  it('sends financial filters, keeping the metric valid when the source changes', async () => {
    const app = makeApp({}, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: '+ financial filter' }))
    await userEvent.selectOptions(screen.getByLabelText('Financial filter 1 source'), 'ratio')
    expect(screen.getByLabelText('Financial filter 1 metric')).toHaveValue('pe_ratio')    // profit_growth_pct is not a ratio
    await userEvent.selectOptions(screen.getByLabelText('Financial filter 1 metric'), 'roce_pct')
    await userEvent.selectOptions(screen.getByLabelText('Financial filter 1 operator'), '>=')
    await userEvent.clear(screen.getByLabelText('Financial filter 1 value'))
    await userEvent.type(screen.getByLabelText('Financial filter 1 value'), '15')
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(app.api.syncPreview).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ source: 'ratio', metric: 'roce_pct', op: '>=', value: 15 }] })))
  })

  it('removes a financial filter', async () => {
    renderIn(<StrategiesView />, makeApp({}, lists))
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: '+ financial filter' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove financial filter 1' }))
    expect(screen.queryByLabelText('Financial filter 1 source')).not.toBeInTheDocument()
  })

  it('hides a preview as soon as a setting changes, so what is synced is what was shown', async () => {
    renderIn(<StrategiesView />, makeApp({}, lists))
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByLabelText('Preview')
    await userEvent.type(field(/tolerance/i), '1')
    expect(screen.queryByLabelText('Preview')).not.toBeInTheDocument()
  })

  it('syncs: reloads the watchlists, opens the new list, announces the outcome and shows it under Synced watchlists', async () => {
    const created = wl('w9', 'Screen: Momentum', [SBIN, TCS])
    const app = makeApp({
      syncApply: async () => syncResult({ watchlist: created, removed: ['NSE:OLD-EQ'], kept_for_trading: ['NSE:HELD-EQ'] }),
      watchlists: async () => [wl('w1', 'Watchlist', [SBIN]), created],
      syncLinks: async () => [syncLink()],
    }, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: 'Sync to watchlist' }))
    await waitFor(() => expect(app.store.get().activeWatchlistId).toBe('w9'))
    expect(app.store.get().watchlists.map((w) => w.name)).toEqual(['Watchlist', 'Screen: Momentum'])
    expect(app.store.get().toast?.text).toBe('“Screen: Momentum”: 1 matched, 1 near. 2 added, 1 removed, 1 kept because you are trading them.')
    const links = await screen.findByLabelText('Synced watchlists')
    expect(within(links).getByText(/1 matched · 1 near · data of 2026-10-16/)).toBeInTheDocument()
    expect(app.socket.setSymbols).toHaveBeenCalled()    // the new symbols start streaming
  })

  it('shows the error when the strategy screener is down and keeps the page usable', async () => {
    const app = makeApp({ syncPreview: async () => { throw new ApiError(502, 'strategy-screener is not reachable at http://127.0.0.1:8000') } }, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not reachable')
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
  })

  it('explains an empty strategy list instead of leaving a dead form', async () => {
    renderIn(<StrategiesView />, makeApp({ syncStrategies: async () => [] }, lists))
    expect(await screen.findByRole('option', { name: 'No strategies found' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  })

  it('opens a synced watchlist beside the chart', async () => {
    const app = makeApp({ syncLinks: async () => [syncLink()] }, { ...lists, view: 'strategies' })
    renderIn(<StrategiesView />, app)
    await userEvent.click(await screen.findByRole('button', { name: 'Screen: Momentum' }))
    expect(app.store.get().activeWatchlistId).toBe('w9')
    expect(app.store.get().view).toBe('chart')
  })

  it('unlinks a list (it stays as an ordinary watchlist)', async () => {
    let links = [syncLink()]
    const app = makeApp({ syncLinks: async () => links, syncUnlink: vi.fn(async () => { links = [] }) }, lists)
    renderIn(<StrategiesView />, app)
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(screen.getByText(/Nothing is synced yet/)).toBeInTheDocument())
    expect(app.api.syncUnlink).toHaveBeenCalledWith('w9')
  })

  it('refreshes all synced lists and reports a failure per strategy', async () => {
    const app = makeApp({
      syncLinks: async () => [syncLink()],
      syncRefresh: async () => [{ strategy_id: 7, ok: false, error: 'strategy-screener is not reachable' }],
    }, lists)
    renderIn(<StrategiesView />, app)
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh all' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh strategy 7: strategy-screener is not reachable')
  })

  it('opens a candidate’s chart', async () => {
    const app = makeApp({ syncPreview: async () => syncPlan({ candidates: [candidate(TCS)] }) }, lists)
    renderIn(<StrategiesView />, app)
    await screen.findByRole('option', { name: 'Momentum' })
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'TCS' }))
    await waitFor(() => expect(app.store.get().symbol).toBe(TCS))
  })
})
