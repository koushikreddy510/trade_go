// What the watchlist shows and what its buttons do.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SBIN, TCS, makeApp, quote, renderIn, wl } from './testharness'
import { WatchlistPanel } from './WatchlistPanel'

afterEach(() => vi.restoreAllMocks())

const withLists = (extra = {}) =>
  makeApp({}, { watchlists: [wl('w1', 'Core', [SBIN, TCS]), wl('w2', 'Swing', ['NSE:INFY-EQ'])], activeWatchlistId: 'w1', symbol: SBIN, ...extra })

describe('WatchlistPanel', () => {
  it('lists the active watchlist with live price and change', () => {
    const app = withLists({ quotes: { [SBIN]: quote(SBIN, 105), [TCS]: quote(TCS, 98) } })
    renderIn(<WatchlistPanel />, app)
    const sbin = screen.getByText('SBIN').closest('li')!
    expect(within(sbin).getByText('105.00')).toBeInTheDocument()
    expect(within(sbin).getByText('+5.00%')).toHaveClass('up')
    const tcs = screen.getByText('TCS').closest('li')!
    expect(within(tcs).getByText('-2.00%')).toHaveClass('down')
  })

  it('shows a dash until the first price arrives, then updates in place', async () => {
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    const row = screen.getByText('SBIN').closest('li')!
    expect(within(row).getByText('—')).toBeInTheDocument()
    app.ctl.onMessage({ type: 'tick', quote: quote(SBIN, 101.5) })
    expect(await within(row).findByText('101.50')).toBeInTheDocument()
  })

  it('highlights the symbol on the chart', () => {
    renderIn(<WatchlistPanel />, withLists())
    expect(screen.getByText('SBIN').closest('li')).toHaveClass('selected')
    expect(screen.getByText('TCS').closest('li')).not.toHaveClass('selected')
  })

  it('opens a symbol’s chart when its row is clicked', async () => {
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    await userEvent.click(screen.getByText('TCS'))
    await waitFor(() => expect(app.store.get().symbol).toBe(TCS))
    expect(app.api.candles).toHaveBeenCalledWith(TCS, '1H')
  })

  it('switches between watchlists with the tabs', async () => {
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    await userEvent.click(screen.getByRole('tab', { name: 'Swing' }))
    expect(screen.getByText('INFY')).toBeInTheDocument()
    expect(screen.queryByText('TCS')).not.toBeInTheDocument()
  })

  it('removes a symbol without also opening its chart', async () => {
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Remove TCS' }))
    await waitFor(() => expect(app.api.removeFromWatchlist).toHaveBeenCalledWith('w1', TCS))
    expect(app.store.get().symbol).toBe(SBIN)
    await waitFor(() => expect(screen.queryByText('TCS')).not.toBeInTheDocument())
  })

  it('adds a symbol found through the search box', async () => {
    const app = withLists()
    app.api.searchSymbols.mockResolvedValue([{ symbol: 'NSE:HDFCBANK-EQ', exchange: 'NSE', name: 'HDFC Bank', sector: 'Banks' }])
    renderIn(<WatchlistPanel />, app)
    await userEvent.type(screen.getByLabelText('Search symbols'), 'hdfc')
    await userEvent.click(await screen.findByRole('option', { name: /HDFCBANK/ }))
    await waitFor(() => expect(app.api.addToWatchlist).toHaveBeenCalledWith('w1', ['NSE:HDFCBANK-EQ']))
    expect(await screen.findByText('HDFCBANK')).toBeInTheDocument()
  })

  it('reorders by dragging one row onto another', async () => {
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    const tcs = screen.getByText('TCS').closest('li')!
    const sbin = screen.getByText('SBIN').closest('li')!
    fireEvent.dragStart(tcs)
    fireEvent.dragOver(sbin)
    fireEvent.drop(sbin)
    await waitFor(() => expect(app.api.reorderWatchlist).toHaveBeenCalledWith('w1', [TCS, SBIN]))
  })

  it('creates a watchlist from a name the user types', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Breakouts')
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    await userEvent.click(screen.getByRole('button', { name: 'New watchlist' }))
    await waitFor(() => expect(app.api.createWatchlist).toHaveBeenCalledWith('Breakouts'))
    expect(await screen.findByRole('tab', { name: 'Breakouts' })).toBeInTheDocument()
  })

  it('does not create a watchlist when the prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    const app = withLists()
    renderIn(<WatchlistPanel />, app)
    await userEvent.click(screen.getByRole('button', { name: 'New watchlist' }))
    expect(app.api.createWatchlist).not.toHaveBeenCalled()
  })

  it('will not offer to delete the only watchlist', () => {
    const app = makeApp({}, { watchlists: [wl('w1', 'Only', [SBIN])], activeWatchlistId: 'w1' })
    renderIn(<WatchlistPanel />, app)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('invites the user to add symbols to an empty list', () => {
    const app = makeApp({}, { watchlists: [wl('w1', 'Empty', [])], activeWatchlistId: 'w1' })
    renderIn(<WatchlistPanel />, app)
    expect(screen.getByText(/Empty\. Search above/)).toBeInTheDocument()
  })
})
