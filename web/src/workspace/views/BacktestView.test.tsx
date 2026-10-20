import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SBIN, btFull, btReport, btRow, btSummary, makeApp, preset, renderIn, rule, wl } from '../components/testharness'
import { BacktestView } from './BacktestView'

const plainRule = (id: string, name: string, over = {}) => rule({ id, name, condition: { type: 'compare', op: '>', a: { kind: 'close' }, b: { kind: 'value', value: 100 } }, stop: { type: 'pct', value: 5 }, ...over })
const RULES = [plainRule('r1', 'Breakout'), plainRule('r2', 'Pullback', { timeframe: '1D' })]
const withRules = (extra: Record<string, unknown> = {}) => makeApp({ rules: async () => RULES, ...extra }, { watchlists: [wl('w1', 'Watchlist', [SBIN])], activeWatchlistId: 'w1' })

async function ready(app = withRules()) {
  renderIn(<BacktestView />, app)
  await screen.findByRole('checkbox', { name: /Breakout/ })
  return app
}
const card = (label: string) => within(screen.getByText(label).closest('.bt-card') as HTMLElement)
const run = () => userEvent.click(screen.getByRole('button', { name: 'Run backtest' }))

describe('BacktestView', () => {
  it('lists the saved rules and cannot run until one is ticked', async () => {
    await ready()
    expect(screen.getByRole('button', { name: 'Run backtest' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /Pullback/ }))
    expect(screen.getByRole('button', { name: 'Run backtest' })).toBeEnabled()
  })

  it('needs stocks to run on: a watchlist, a screen or some symbols', async () => {
    await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'Symbols' }))
    expect(screen.getByRole('button', { name: 'Run backtest' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Symbols'), 'SBIN')
    expect(screen.getByRole('button', { name: 'Run backtest' })).toBeEnabled()
  })

  it('sends the capital, allocation and chosen rules for the selected watchlist', async () => {
    const app = await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await userEvent.clear(screen.getByLabelText('Capital'))
    await userEvent.type(screen.getByLabelText('Capital'), '500000')
    await userEvent.clear(screen.getByLabelText('Per trade %'))
    await userEvent.type(screen.getByLabelText('Per trade %'), '20')
    await userEvent.type(screen.getByLabelText('Max open'), '4')
    await run()
    await waitFor(() => expect(app.api.startBacktest).toHaveBeenCalledWith({
      start: '2025-10-01', end: expect.any(String), capital: 500000, allocation_pct: 20, rule_ids: ['r1'], cost_pct: 0, max_positions: 4, watchlist_id: 'w1',
    }))
  })

  it('can run on a screener preset that is re-run every few days', async () => {
    const app = await ready(withRules({ presets: async () => [preset('uptrend'), preset('oversold')] }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'Screener' }))
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'oversold')
    await userEvent.clear(screen.getByLabelText('Re-screen every (days)'))
    await userEvent.type(screen.getByLabelText('Re-screen every (days)'), '14')
    await run()
    await waitFor(() => expect(app.api.startBacktest).toHaveBeenCalledWith(expect.objectContaining({ screen: { preset: 'oversold' }, rescreen_days: 14 })))
    expect(vi_calls(app)[0]).not.toHaveProperty('watchlist_id')
  })

  it('accepts bare symbols and turns them into NSE equities', async () => {
    const app = await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'Symbols' }))
    await userEvent.type(screen.getByLabelText('Symbols'), 'sbin, TCS nse:infy-eq')
    await run()
    await waitFor(() => expect(app.api.startBacktest).toHaveBeenCalledWith(expect.objectContaining({ symbols: ['NSE:SBIN-EQ', 'NSE:TCS-EQ', 'NSE:INFY-EQ'] })))
  })

  it('shows the report: headline numbers, open positions, trades and notes', async () => {
    const app = await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await run()
    expect(await screen.findByText('Closed trades')).toBeInTheDocument()
    expect(card('Return').getByText('+10.00%')).toHaveClass('up')
    expect(card('Final equity').getByText('11,00,000')).toBeInTheDocument()
    const open = screen.getByRole('table', { name: 'Open positions' })
    expect(within(open).getByText('INFY')).toBeInTheDocument()
    expect(within(open).getByText('+1,000.00')).toHaveClass('up')
    const trades = within(screen.getByRole('table', { name: 'Trades' })).getAllByRole('row').slice(1)
    expect(trades).toHaveLength(2)
    expect(within(trades[0]).getByText('TCS')).toBeInTheDocument()                    // newest first
    expect(within(trades[0]).getByText('-1,000.00')).toHaveClass('down')
    expect(within(trades[0]).getByText('exit rule')).toBeInTheDocument()
    expect(within(trades[1]).getByText(/02 Oct, 15:15 @ 890.00/)).toBeInTheDocument() // 09:45 UTC = 15:15 IST
    expect(screen.getByRole('img', { name: 'Equity curve' })).toBeInTheDocument()
    expect(screen.getByText(/2 × not enough cash for one share/)).toBeInTheDocument()
    expect(screen.getByText(/marked at the last close/)).toBeInTheDocument()
    expect(app.api.backtest).toHaveBeenCalledWith('b1')
  })

  it('polls a running backtest until it is done', async () => {
    let calls = 0
    const app = await ready(withRules({ backtest: async () => (++calls < 3 ? btFull({ status: 'running', progress: '2026-02-03', result: null }) : btFull()) }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await run()
    expect(await screen.findByRole('status')).toHaveTextContent('Running… 2026-02-03')
    expect(await screen.findByText('Closed trades', {}, { timeout: 6000 })).toBeInTheDocument()
    expect(app.api.backtests).toHaveBeenCalledTimes(3)       // on open, after starting, once it finished
  }, 10000)

  it('says why a backtest failed', async () => {
    await ready(withRules({ backtest: async () => btFull({ status: 'failed', error: 'boom', result: null }) }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await run()
    expect(await screen.findByRole('alert')).toHaveTextContent('Backtest failed: boom')
  })

  it('shows the server’s reason when it refuses the request', async () => {
    await ready(withRules({ startBacktest: async () => { throw new Error('choose the stocks with exactly one of symbols, watchlist_id or screen') } }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await run()
    expect(await screen.findByRole('alert')).toHaveTextContent('exactly one of')
  })

  it('reopens and deletes earlier runs', async () => {
    const app = await ready(withRules({ backtests: async () => [btRow(), btRow({ id: 'b2', status: 'failed', summary: null })] }))
    const list = screen.getByRole('list', { name: 'Earlier runs' })
    expect(within(list).getByText('+10.00%')).toBeInTheDocument()
    expect(within(list).getByText('failed')).toBeInTheDocument()
    await userEvent.click(within(list).getAllByRole('button', { name: /2025-10-01/ })[0])
    expect(await screen.findByText('Closed trades')).toBeInTheDocument()
    await userEvent.click(within(list).getAllByRole('button', { name: /Delete run/ })[1])
    await waitFor(() => expect(app.api.deleteBacktest).toHaveBeenCalledWith('b2'))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
  })

  it('warns that a rule built on a drawn line only runs on its own chart', async () => {
    renderIn(<BacktestView />, makeApp({ rules: async () => [rule({ id: 'r9', name: 'Line break' })] }))
    expect(await screen.findByRole('checkbox', { name: /uses a drawn line, so only SBIN/ })).toBeInTheDocument()
  })

  it('a period without trades says so', async () => {
    await ready(withRules({ backtest: async () => btFull({ result: btReport({ trades: [], open: [], summary: btSummary({ trades: 0, win_rate_pct: null, profit_factor: null }) }) }) }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Breakout/ }))
    await run()
    expect(await screen.findByText('No trade closed in this period.')).toBeInTheDocument()
  })
})

const vi_calls = (app: ReturnType<typeof makeApp>) => (app.api.startBacktest as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0] as Record<string, unknown>)

describe('showing a backtest on the chart', () => {
  it('opens the chart for a stock from its trade row, with the trades attached', async () => {
    const app = makeApp({ backtests: async () => [btRow()], backtest: async () => btFull() }, { view: 'backtests' })
    renderIn(<BacktestView />, app)
    await userEvent.click(await screen.findByRole('button', { name: /2025-10-01 → 2025-10-03/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'TCS' }))
    await waitFor(() => expect(app.store.get()).toMatchObject({ symbol: 'NSE:TCS-EQ', view: 'chart' }))
    const o = app.store.get().btOverlay!
    expect([o.label, o.trades.length, o.focus]).toEqual(['2025-10-01 → 2025-10-03', 2, Date.parse('2025-10-02T09:45:00+00:00') / 1000])
    expect(app.api.candles).toHaveBeenCalledWith('NSE:TCS-EQ', '1H', 5000)
  })
})
