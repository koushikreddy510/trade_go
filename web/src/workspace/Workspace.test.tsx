// The whole screen, end to end against a fake server: boot, click around, and watch live
// messages change what is shown. The chart itself is faked (it needs a canvas).
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SBIN, TCS, financials, makeApp, position, quote, signal } from './components/testharness'

const h = vi.hoisted(() => ({ charts: [] as { setPriceLines: ReturnType<typeof vi.fn>; setCandles: ReturnType<typeof vi.fn> }[] }))
vi.mock('./chart/ChartView', () => ({
  ChartView: class {
    setCandles = vi.fn(); setIndicators = vi.fn(); setPriceLines = vi.fn(); setMarkers = vi.fn(); setDrawings = vi.fn(); setTool = vi.fn(); setSegments = vi.fn(); focus = vi.fn(); setTheme = vi.fn(); destroy = vi.fn()
    constructor() { h.charts.push(this) }
  },
}))
import Workspace from './Workspace'

beforeEach(() => { h.charts.length = 0 })

describe('Workspace', () => {
  const boot = async (over: Record<string, unknown> = {}) => {
    const app = makeApp(over)
    render(<Workspace ctx={app.ctx} />)
    await waitFor(() => expect(app.store.get().booted).toBe(true))
    await waitFor(() => expect(app.store.get().candles.length).toBeGreaterThan(0))
    return app
  }

  it('boots into the chart with the watchlist, the demo badge and the first symbol loaded', async () => {
    const app = await boot()
    expect(screen.getByText('DEMO DATA')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Watchlist' })).toBeInTheDocument()
    expect(screen.getAllByText('SBIN').length).toBeGreaterThan(0)
    expect(app.api.candles).toHaveBeenCalledWith(SBIN, '1H')
    expect(app.socket.connect).toHaveBeenCalled()
  })

  it('a live tick appears in the watchlist and the chart header', async () => {
    const app = await boot()
    act(() => app.ctl.onMessage({ type: 'tick', quote: quote(SBIN, 107) }))
    const row = screen.getByRole('complementary', { name: 'Watchlists' }).querySelector('li.selected')!
    await waitFor(() => expect(within(row as HTMLElement).getByText('107.00')).toBeInTheDocument())
  })

  it('a position opened by a rule shows up in the panel and as SL/TP lines on the chart, then disappears when stopped out', async () => {
    const app = await boot()
    const chart = h.charts[h.charts.length - 1]
    const p = position()
    act(() => app.ctl.onMessage({ type: 'signal', signal: signal() }))
    act(() => app.ctl.onMessage({ type: 'position', position: p }))
    expect(await screen.findByTestId('pnl-p1')).toBeInTheDocument()
    await waitFor(() => expect(chart.setPriceLines.mock.lastCall![0].map((l: { title: string }) => l.title.split(' ')[0])).toEqual(['BUY', 'SL', 'TP']))
    expect(screen.getByText(/Signal: BUY SBIN 1H @ 101.00/)).toBeInTheDocument() // the toast

    act(() => app.ctl.onMessage({ type: 'position', position: { ...p, status: 'closed', exit_reason: 'stop', exit_price: 95, realized_pnl: -50 } }))
    await waitFor(() => expect(chart.setPriceLines.mock.lastCall![0]).toEqual([]))
    expect(screen.getByText('stop')).toBeInTheDocument() // in the closed list
  })

  it('switching symbol loads that chart and that symbol’s financials', async () => {
    const app = await boot({ financials: vi.fn(async (symbol: string) => financials({ symbol, company: symbol === TCS ? 'Tata Consultancy Services' : 'State Bank of India' })) })
    await userEvent.click(screen.getByRole('tab', { name: /Financials/ }))
    expect(await screen.findByText('State Bank of India')).toBeInTheDocument()
    await userEvent.click(screen.getByText('TCS'))
    expect(await screen.findByText('Tata Consultancy Services')).toBeInTheDocument()
    expect(app.api.candles).toHaveBeenCalledWith(TCS, '1H')
  })

  it('the Screener tab replaces the chart; opening a result returns to the chart', async () => {
    const app = await boot()
    await userEvent.click(screen.getByRole('button', { name: 'Screener' }))
    expect(screen.queryByTestId('chart-host')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'TCS', hidden: false }))
    await waitFor(() => expect(app.store.get().view).toBe('chart'))
    expect(screen.getByTestId('chart-host')).toBeInTheDocument()
  })

  it('the new-rule dialog opens over the chart and a saved rule lands in the Rules tab', async () => {
    const app = await boot()
    await userEvent.click(screen.getByRole('tab', { name: /Rules/ }))
    await userEvent.click(screen.getByRole('button', { name: /New rule for SBIN/ }))
    await userEvent.type(screen.getByLabelText('Rule name'), 'My rule')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('My rule')).toBeInTheDocument()
  })

  it('shows a server error as a message instead of failing silently', async () => {
    const app = await boot()
    act(() => app.ctl.onMessage({ type: 'error', message: 'broker rejected the subscription' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('broker rejected the subscription')
  })

  it('disconnects from the server when the screen is closed', async () => {
    const app = makeApp()
    const view = render(<Workspace ctx={app.ctx} />)
    await waitFor(() => expect(app.store.get().booted).toBe(true))
    view.unmount()
    expect(app.socket.close).toHaveBeenCalled()
  })
})
