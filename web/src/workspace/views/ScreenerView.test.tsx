// The daily-candle screener: presets, custom filters, sorting, and sending hits to a watchlist.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SBIN, TCS, makeApp, preset, renderIn, screen as screenResult, screenRow, wl } from '../components/testharness'
import { ScreenerView } from './ScreenerView'

const symbolsInOrder = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)
const lists = { watchlists: [wl('w1', 'Core', [SBIN])], activeWatchlistId: 'w1' }

describe('ScreenerView', () => {
  it('opens on the first preset and shows its matches from the latest daily scan', async () => {
    const app = makeApp({}, lists)
    renderIn(<ScreenerView />, app)
    expect(await screen.findByText('SBIN')).toBeInTheDocument()
    expect(app.api.runPreset).toHaveBeenCalledWith('uptrend')
    expect(screen.getByText('Daily scan of 2026-10-16')).toBeInTheDocument()
    expect(screen.getByText('2 matches')).toBeInTheDocument()
    expect(screen.getByText('uptrend stocks')).toBeInTheDocument() // the preset's description
  })

  it('formats the figures and colours moves', async () => {
    renderIn(<ScreenerView />, makeApp({}, lists))
    const tcs = (await screen.findByText('TCS')).closest('tr')!
    expect(within(tcs).getByText('-1.00%')).toHaveClass('down')
    expect(within(tcs).getByText('2.1×')).toBeInTheDocument()
  })

  it('runs another preset when its chip is clicked', async () => {
    const app = makeApp({}, lists)
    renderIn(<ScreenerView />, app)
    await screen.findByText('SBIN')
    await userEvent.click(screen.getByRole('button', { name: 'oversold' }))
    await waitFor(() => expect(app.api.runPreset).toHaveBeenLastCalledWith('oversold'))
  })

  it('sorts by a column in the browser without asking the server again', async () => {
    const app = makeApp({
      runPreset: vi.fn(async () => screenResult([screenRow('NSE:A-EQ', { close: 300 }), screenRow('NSE:B-EQ', { close: 100 }), screenRow('NSE:C-EQ', { close: 200 })])),
    }, lists)
    renderIn(<ScreenerView />, app)
    await screen.findByText('A')
    const calls = app.api.runPreset.mock.calls.length
    await userEvent.click(screen.getByRole('columnheader', { name: /^Close/ }))
    expect(symbolsInOrder()).toEqual(['A', 'C', 'B']) // high to low first
    await userEvent.click(screen.getByRole('columnheader', { name: /^Close/ }))
    expect(symbolsInOrder()).toEqual(['B', 'C', 'A'])
    expect(app.api.runPreset.mock.calls.length).toBe(calls)
  })

  it('keeps rows with a missing value at the bottom whichever way it sorts', async () => {
    const app = makeApp({
      runPreset: async () => screenResult([screenRow('NSE:A-EQ', { rsi_14: null }), screenRow('NSE:B-EQ', { rsi_14: 20 }), screenRow('NSE:C-EQ', { rsi_14: 80 })]),
    }, lists)
    renderIn(<ScreenerView />, app)
    await screen.findByText('A')
    await userEvent.click(screen.getByRole('columnheader', { name: /^RSI/ }))
    expect(symbolsInOrder()).toEqual(['C', 'B', 'A'])
    await userEvent.click(screen.getByRole('columnheader', { name: /^RSI/ }))
    expect(symbolsInOrder()).toEqual(['B', 'C', 'A'])
  })

  it('opens the chart for a result', async () => {
    const app = makeApp({}, { ...lists, view: 'screener' })
    renderIn(<ScreenerView />, app)
    await userEvent.click(await screen.findByRole('button', { name: 'TCS' }))
    await waitFor(() => expect(app.store.get()).toMatchObject({ symbol: TCS, view: 'chart' }))
  })

  it('adds a result to the active watchlist, and shows when it is already there', async () => {
    const app = makeApp({}, lists)
    renderIn(<ScreenerView />, app)
    const sbin = (await screen.findByText('SBIN')).closest('tr')!
    expect(within(sbin).getByRole('button', { name: 'In list' })).toBeDisabled()
    const tcs = screen.getByText('TCS').closest('tr')!
    await userEvent.click(within(tcs).getByRole('button', { name: '+ Core' }))
    await waitFor(() => expect(app.api.addToWatchlist).toHaveBeenCalledWith('w1', [TCS]))
  })

  describe('custom screens', () => {
    it('builds a filter list and sends it to the server', async () => {
      const app = makeApp({}, lists)
      renderIn(<ScreenerView />, app)
      await screen.findByText('SBIN')
      await userEvent.click(screen.getByRole('button', { name: 'Custom…' }))
      await userEvent.selectOptions(screen.getByLabelText('Filter 1 field'), 'rsi_14')
      await userEvent.selectOptions(screen.getByLabelText('Filter 1 operator'), '<')
      await userEvent.clear(screen.getByLabelText('Filter 1 value'))
      await userEvent.type(screen.getByLabelText('Filter 1 value'), '35')
      await userEvent.click(screen.getByRole('button', { name: '+ filter' }))
      await userEvent.selectOptions(screen.getByLabelText('Filter 2 field'), 'close')
      await userEvent.selectOptions(screen.getByLabelText('Filter 2 operator'), '>')
      await userEvent.selectOptions(screen.getByLabelText('Filter 2 compares to'), 'sma_200')
      await userEvent.click(screen.getByRole('button', { name: 'Run screen' }))
      await waitFor(() => expect(app.api.runScreen).toHaveBeenCalledOnce())
      expect(app.api.runScreen.mock.calls[0].slice(0, 2)).toEqual([
        [{ field: 'rsi_14', op: '<', value: 35 }, { field: 'close', op: '>', value: { field: 'sma_200' } }],
        expect.any(String),
      ])
    })

    it('shows the server’s reason when a screen is rejected', async () => {
      const app = makeApp({ runScreen: async () => { throw new Error("unknown field 'foo'") } }, lists)
      renderIn(<ScreenerView />, app)
      await screen.findByText('SBIN')
      await userEvent.click(screen.getByRole('button', { name: 'Custom…' }))
      await userEvent.click(screen.getByRole('button', { name: 'Run screen' }))
      expect(await screen.findByRole('alert')).toHaveTextContent("unknown field 'foo'")
    })

    it('can drop a filter, and cannot run with none', async () => {
      renderIn(<ScreenerView />, makeApp({}, lists))
      await screen.findByText('SBIN')
      await userEvent.click(screen.getByRole('button', { name: 'Custom…' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter 1' }))
      expect(screen.getByRole('button', { name: 'Run screen' })).toBeDisabled()
    })
  })

  describe('the daily scan', () => {
    it('is run on demand, tells the user what it did, and refreshes the list', async () => {
      const app = makeApp({}, lists)
      renderIn(<ScreenerView />, app)
      await screen.findByText('SBIN')
      const before = app.api.runPreset.mock.calls.length
      await userEvent.click(screen.getByRole('button', { name: 'Run daily scan' }))
      await waitFor(() => expect(app.api.runScan).toHaveBeenCalledOnce())
      await waitFor(() => expect(app.api.runPreset.mock.calls.length).toBe(before + 1))
      expect(app.store.get().toast?.text).toBe('Scan done: 9 symbols analysed, 1 skipped (too little history).')
    })

    it('invites the user to run it when nothing has been scanned yet', async () => {
      const app = makeApp({ runPreset: async () => ({ run_date: null, count: 0, rows: [] }) }, lists)
      renderIn(<ScreenerView />, app)
      expect(await screen.findByText(/Run the daily scan/)).toBeInTheDocument()
      expect(screen.getByText('No scan has been run yet')).toBeInTheDocument()
    })

    it('says so plainly when a scan has run but nothing matches', async () => {
      renderIn(<ScreenerView />, makeApp({ runPreset: async () => screenResult([]) }, lists))
      expect(await screen.findByText('No symbols match.')).toBeInTheDocument()
    })

    it('reports a failed scan instead of hanging', async () => {
      const app = makeApp({ runScan: async () => { throw new Error('data-store is unreachable') } }, lists)
      renderIn(<ScreenerView />, app)
      await screen.findByText('SBIN')
      await userEvent.click(screen.getByRole('button', { name: 'Run daily scan' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('data-store is unreachable')
      expect(screen.getByRole('button', { name: 'Run daily scan' })).toBeEnabled()
    })
  })

  describe('financial screens', () => {
    const fundamentals = {
      presets: async () => [
        preset('uptrend', { group: 'Price and volume' }),
        preset('magic_formula', { label: 'Magic formula', group: 'Value and quality', show: ['close', 'pe_ratio', 'roce_pct', 'q_growth_streak'], sort: 'magic_rank', descending: false }),
      ],
      columns: async () => ({
        columns: [
          { name: 'pe_ratio', label: 'P/E', unit: 'x', short: 'P/E' }, { name: 'roce_pct', label: 'ROCE, %', unit: 'pct', short: 'ROCE %' },
          { name: 'q_growth_streak', label: 'streak', unit: 'int', short: 'Growth streak' }, { name: 'close', label: 'Last close', unit: 'price', short: 'Close' },
        ],
        operators: ['>', '<'],
      }),
      runPreset: async (name: string) => screenResult([screenRow(SBIN, name === 'magic_formula' ? { pe_ratio: 12.34, roce_pct: 27.5, q_growth_streak: 3 } : {})]),
    }

    it('groups the screens and labels each group', async () => {
      renderIn(<ScreenerView />, makeApp(fundamentals, lists))
      const g = within(await screen.findByRole('group', { name: 'Value and quality' }))
      expect(g.getByRole('button', { name: 'Magic formula' })).toBeInTheDocument()
      expect(within(screen.getByRole('group', { name: 'Price and volume' })).getByRole('button', { name: 'uptrend' })).toBeInTheDocument()
    })

    it('shows the columns that suit the screen, written in their own units', async () => {
      renderIn(<ScreenerView />, makeApp(fundamentals, lists))
      await userEvent.click(await screen.findByRole('button', { name: 'Magic formula' }))
      expect(await screen.findByRole('columnheader', { name: 'ROCE %' })).toBeInTheDocument()
      expect(screen.queryByRole('columnheader', { name: 'RSI' })).toBeNull()
      const row = screen.getByText('SBIN').closest('tr')!
      expect(within(row).getByText('12.3')).toBeInTheDocument()
      expect(within(row).getByText('+27.5%')).not.toHaveClass('up') // a return on capital is a level, not a move
      expect(within(row).getByText('3')).toBeInTheDocument()
    })

    it('saves the matches as a watchlist', async () => {
      const app = makeApp({ ...fundamentals, runPreset: async () => screenResult([screenRow(SBIN), screenRow(TCS)]) }, lists)
      renderIn(<ScreenerView />, app)
      await screen.findByText('SBIN')
      await userEvent.click(screen.getByRole('button', { name: 'Save as watchlist' }))
      await waitFor(() => expect(app.api.createWatchlist).toHaveBeenCalledWith('uptrend 2026-10-16', [SBIN, TCS]))
    })
  })
})
