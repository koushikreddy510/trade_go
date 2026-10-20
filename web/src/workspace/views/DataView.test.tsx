import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { dataOverview, makeApp, renderIn } from '../components/testharness'
import { DataView } from './DataView'

const row = (name: string) => within(screen.getByText(name).closest('tr') as HTMLElement)

describe('DataView', () => {
  it('shows how complete and how fresh the data is', async () => {
    renderIn(<DataView />, makeApp())
    expect(await screen.findByText('2026-10-16')).toBeInTheDocument()
    expect(screen.getByText('80% with a sector · 90% with market cap')).toBeInTheDocument()
    expect(screen.getByText('95 stocks on that day · 99 in all')).toBeInTheDocument()
    expect(screen.getByText('12 in the last 7 days · 500 in all')).toBeInTheDocument()
  })

  it('says what needs attention', async () => {
    renderIn(<DataView />, makeApp())
    const todo = within(await screen.findByLabelText('What needs attention'))
    expect(todo.getByText(/20 stocks have no sector/)).toBeInTheDocument()
    expect(todo.getByText(/fewer than half/)).toBeInTheDocument()
  })

  it('warns when the newest daily candle is old', async () => {
    const base = dataOverview()
    renderIn(<DataView />, makeApp({ dataStatus: async () => ({ ...base, status: { ...base.status, ohlcv_1d: { ...base.status.ohlcv_1d!, latest: '2020-01-01' } } }) }))
    expect(await screen.findByText(/The newest daily candle is \d+ days old/)).toBeInTheDocument()
  })

  it('starts a job with the options picked, then refreshes', async () => {
    const app = makeApp()
    renderIn(<DataView />, app)
    await screen.findByText('Financials (screener.in)')
    const r = row('Financials (screener.in)')
    await userEvent.selectOptions(r.getByLabelText('mode'), 'announcements_only')
    await userEvent.type(r.getByLabelText('limit'), '50')
    await userEvent.click(r.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(app.api.runDataJob).toHaveBeenCalledWith({ job: 'financials', mode: 'announcements_only', limit: '50' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Financials (screener.in): started')
    expect(app.api.dataStatus).toHaveBeenCalledTimes(2)
  })

  it('shows progress of a running job and blocks a second start', async () => {
    const app = makeApp({ dataStatus: async () => dataOverview({ jobs: { sectors: { status: 'running', progress: '[3/200] SBIN' } } }) })
    renderIn(<DataView />, app)
    await screen.findByText('Sectors and market cap (NSE)')
    expect(row('Sectors and market cap (NSE)').getByText(/running · \[3\/200\] SBIN/)).toBeInTheDocument()
    expect(row('Sectors and market cap (NSE)').getByRole('button', { name: 'Running…' })).toBeDisabled()
  })

  it('keeps working when the screener service is down, and says so', async () => {
    renderIn(<DataView />, makeApp({ dataStatus: async () => dataOverview({ jobs: null, jobs_error: 'strategy-screener is not reachable' }) }))
    expect(await screen.findByText(/Job status unavailable: strategy-screener is not reachable/)).toBeInTheDocument()
    expect(screen.getByText('2026-10-16')).toBeInTheDocument()
  })

  it('shows an error from starting a job', async () => {
    const app = makeApp({ runDataJob: async () => { throw new Error('Fyers token expired') } })
    renderIn(<DataView />, app)
    await userEvent.click(await within(await screen.findByText('Sectors and market cap (NSE)').then((e) => e.closest('tr') as HTMLElement)).findByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fyers token expired')
  })

  it('lists symbols added and removed since the last digest', async () => {
    renderIn(<DataView />, makeApp())
    expect(await screen.findByText('Added (1)')).toBeInTheDocument()
    expect(screen.getByText('NSE:NEW-EQ')).toBeInTheDocument()
    expect(screen.getByText('Removed (0)')).toBeInTheDocument()
  })

  it('explains an empty comparison', async () => {
    renderIn(<DataView />, makeApp({ dataStatus: async () => dataOverview({ status: { symbols: { total: 5, with_sector: 5, with_market_cap: 5 }, changes: null } }) }))
    expect(await screen.findByText(/Nothing to compare with yet/)).toBeInTheDocument()
  })
})
