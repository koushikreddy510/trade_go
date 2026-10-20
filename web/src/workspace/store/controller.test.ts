// The controller is the app's behaviour: what loads when, what a live message changes,
// and what each user action sends to the server. A fake API and a fake socket stand in
// for the network, so each test reads like a short story.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { Candle, Drawing, Position, Quote, Rule, Signal, Watchlist } from '../api/types'
import { candle, ist } from '../lib/testutil'
import { Controller } from './controller'
import { createStore } from './store'
import { initialState, type AppState } from './state'

const SBIN = 'NSE:SBIN-EQ'
const TCS = 'NSE:TCS-EQ'
const H1 = ist(2026, 10, 19, 9, 15)

const wl = (id: string, name: string, symbols: string[]): Watchlist => ({ id, name, symbols })
const quote = (symbol: string, price: number, ts = ist(2026, 10, 19, 9, 40)): Quote => ({ symbol, price, ts, prev_close: 100, open: null, high: null, low: null, volume: null, change: price - 100, change_pct: price - 100 })
const position = (over: Partial<Position> = {}): Position => ({
  id: 'p1', source: 'paper', signal_id: 's1', symbol: SBIN, side: 'BUY', quantity: 10, entry_price: 101, stop: 99.6, target: 103.8, status: 'open',
  opened_at: 1, closed_at: null, exit_price: null, exit_reason: null, realized_pnl: null, ...over,
})
const line = (over: Partial<Drawing> = {}): Drawing => ({ id: 'd1', symbol: SBIN, kind: 'horizontal_line', points: [{ time: H1, price: 100 }], style: {}, label: '', ...over })

function setup(over: Record<string, unknown> = {}) {
  const candles: Candle[] = [candle(ist(2026, 10, 16, 15, 15), 99, 101, 98, 100), candle(H1, 100, 102, 99, 101)]
  const api = {
    status: vi.fn(async () => ({ mode: 'demo', feed: 'connected', now: 0, subscribed: [], clients: 0 })),
    candles: vi.fn(async (symbol: string, timeframe: string) => ({ symbol, timeframe, forming: true, candles })),
    watchlists: vi.fn(async () => [wl('w1', 'Watchlist', [SBIN, TCS])]),
    createWatchlist: vi.fn(async (name: string, symbols: string[] = []) => wl('w2', name, symbols)),
    renameWatchlist: vi.fn(async (id: string, name: string) => wl(id, name, [SBIN, TCS])),
    deleteWatchlist: vi.fn(async () => undefined),
    addToWatchlist: vi.fn(async (id: string, symbols: string[]) => ({ added: symbols, watchlist: wl(id, 'Watchlist', [SBIN, TCS, ...symbols]) })),
    removeFromWatchlist: vi.fn(async (id: string, symbol: string) => wl(id, 'Watchlist', [SBIN, TCS].filter((s) => s !== symbol))),
    reorderWatchlist: vi.fn(async (id: string, symbols: string[]) => wl(id, 'Watchlist', symbols)),
    drawings: vi.fn(async () => [] as Drawing[]),
    createDrawing: vi.fn(async (d: Partial<Drawing>) => ({ ...line(), ...d, id: 'new1' }) as Drawing),
    updateDrawing: vi.fn(async (id: string, patch: Partial<Drawing>) => ({ ...line({ id }), ...patch }) as Drawing),
    deleteDrawing: vi.fn(async () => undefined),
    rules: vi.fn(async () => [] as Rule[]),
    saveRule: vi.fn(async (d: Partial<Rule>) => ({ ...d, id: d.id ?? 'r1' }) as Rule),
    setRuleEnabled: vi.fn(async (id: string, enabled: boolean) => ({ id, enabled }) as Rule),
    deleteRule: vi.fn(async () => undefined),
    signals: vi.fn(async () => [] as Signal[]),
    positions: vi.fn(async () => ({ open: [] as Position[], closed: [] as Position[] })),
    closePosition: vi.fn(async (id: string) => position({ id, status: 'closed', exit_reason: 'manual', exit_price: 104, realized_pnl: 30 })),
    financials: vi.fn(async (symbol: string) => ({ symbol, available: false, company: '', quarterly: [], annual: [], ratios: {}, announcements: [] })),
    ...over,
  }
  const socket = { setSymbols: vi.fn(), connect: vi.fn(), close: vi.fn() }
  const storage = new Map<string, string>()
  const store = createStore<AppState>({ ...initialState })
  const ctl = new Controller(api as never, socket, store, { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v) })
  return { api, socket, store, ctl, storage, candles }
}
const subscribed = (socket: ReturnType<typeof setup>['socket']) => [...(socket.setSymbols.mock.calls.at(-1)?.[0] as Set<string>)].sort()

describe('starting up', () => {
  it('loads watchlists, positions, rules and the first symbol’s chart, then connects live', async () => {
    const { ctl, store, socket, api } = setup()
    await ctl.boot()
    const s = store.get()
    expect(s.booted).toBe(true)
    expect(s.watchlists[0].symbols).toEqual([SBIN, TCS])
    expect(s.symbol).toBe(SBIN) // the first symbol of the first watchlist
    expect(s.candles).toHaveLength(2)
    expect(api.candles).toHaveBeenCalledWith(SBIN, '1H')
    expect(socket.connect).toHaveBeenCalledOnce()
    expect(s.server?.mode).toBe('demo')
  })

  it('watches every watchlist symbol plus the open chart and any open position', async () => {
    const { ctl, socket } = setup({ positions: vi.fn(async () => ({ open: [position({ symbol: 'NSE:INFY-EQ' })], closed: [] })) })
    await ctl.boot()
    expect(subscribed(socket)).toEqual(['NSE:INFY-EQ', SBIN, TCS].sort())
  })

  it('remembers symbol, timeframe and indicators between visits', async () => {
    const a = setup()
    await a.ctl.boot()
    await a.ctl.selectSymbol(TCS)
    await a.ctl.setTimeframe('15m')
    a.ctl.addIndicator('rsi')

    const b = setup()
    b.storage.set(...(Array.from(a.storage.entries())[0] as [string, string]))
    await b.ctl.boot()
    expect(b.store.get()).toMatchObject({ symbol: TCS, timeframe: '15m' })
    expect(b.store.get().indicators.map((i) => i.name)).toEqual(['ema', 'rsi'])
  })

  it('remembers the chosen theme, and starts black on a first visit', async () => {
    const a = setup()
    await a.ctl.boot()
    expect(a.store.get().theme.bg).toBe('#000000')
    a.ctl.setTheme({ ...a.store.get().theme, up: '#00ff00' })
    const b = setup()
    b.storage.set(...(Array.from(a.storage.entries())[0] as [string, string]))
    await b.ctl.boot()
    expect(b.store.get().theme).toMatchObject({ bg: '#000000', up: '#00ff00' })
  })

  it('remembers whether result markers and the P/E pane were on', async () => {
    const a = setup()
    await a.ctl.boot()
    a.ctl.toggleResults()
    a.ctl.togglePe()
    expect(a.store.get()).toMatchObject({ showResults: false, showPe: true })

    const b = setup()
    b.storage.set(...(Array.from(a.storage.entries())[0] as [string, string]))
    await b.ctl.boot()
    expect(b.store.get()).toMatchObject({ showResults: false, showPe: true })
  })

  it('still starts when some requests fail, and tells the user', async () => {
    const { ctl, store } = setup({ rules: vi.fn(async () => { throw new ApiError(503, 'terminal is not running') }) })
    await ctl.boot()
    expect(store.get().booted).toBe(true)
    expect(store.get().toast).toMatchObject({ kind: 'error', text: 'terminal is not running' })
  })
})

describe('changing what is on the chart', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.ctl.boot()
  })

  it('selecting a symbol loads its candles, drawings and financials and watches it', async () => {
    await t.ctl.selectSymbol('NSE:INFY-EQ')
    expect(t.api.candles).toHaveBeenLastCalledWith('NSE:INFY-EQ', '1H')
    expect(t.api.drawings).toHaveBeenLastCalledWith('NSE:INFY-EQ')
    expect(t.api.financials).toHaveBeenLastCalledWith('NSE:INFY-EQ')
    expect(subscribed(t.socket)).toContain('NSE:INFY-EQ')
  })

  it('changing timeframe reloads candles for the same symbol', async () => {
    await t.ctl.setTimeframe('5m')
    expect(t.api.candles).toHaveBeenLastCalledWith(SBIN, '5m')
    expect(t.store.get().timeframe).toBe('5m')
  })

  it('a slow answer for an old symbol never overwrites the one the user moved to', async () => {
    let release!: (v: unknown) => void
    const slow = new Promise((r) => (release = r))
    t.api.candles.mockImplementationOnce((async () => { await slow; return { symbol: TCS, timeframe: '1H', forming: false, candles: [candle(1, 1, 1, 1, 1)] } }) as never)
    const first = t.ctl.selectSymbol(TCS)
    await Promise.resolve()
    await t.ctl.selectSymbol('NSE:INFY-EQ')
    release(null)
    await first
    expect(t.store.get().symbol).toBe('NSE:INFY-EQ')
    expect(t.store.get().candles).toHaveLength(2) // INFY’s candles, not TCS’s single stale bar
  })
})

describe('after the live connection drops and returns', () => {
  it('re-reads the chart, signals and positions, because pushes sent while it was down are never replayed', async () => {
    const t = setup()
    await t.ctl.boot()
    t.ctl.onConnection('open')                                   // first connection: boot already loaded everything
    expect(t.api.candles).toHaveBeenCalledTimes(1)
    t.ctl.onConnection('closed')
    t.api.candles.mockResolvedValueOnce({ symbol: SBIN, timeframe: '1H', forming: true, candles: [candle(H1 - 7200, 90, 91, 89, 90), candle(H1 - 3600, 90, 95, 90, 94), candle(H1, 94, 99, 93, 98)] })
    t.api.positions.mockResolvedValueOnce({ open: [position({ id: 'p9' })], closed: [] })
    t.ctl.onConnection('open')                                   // reconnected
    await vi.waitFor(() => expect(t.store.get().candles).toHaveLength(3))
    expect(t.store.get().positions.open.map((p) => p.id)).toEqual(['p9'])
    expect(t.api.signals).toHaveBeenCalledTimes(2)
    expect(t.store.get().connection).toBe('open')
  })

  it('does not refetch on the very first connection', async () => {
    const t = setup()
    await t.ctl.boot()
    t.ctl.onConnection('connecting')
    t.ctl.onConnection('open')
    expect(t.api.positions).toHaveBeenCalledTimes(1)
  })

  it('keeps the drawings and rules it already has, and survives a failed refresh', async () => {
    const t = setup()
    await t.ctl.boot()
    t.store.set({ drawings: [line()], rules: [{ id: 'r1' } as Rule] })
    t.ctl.onConnection('open'); t.ctl.onConnection('closed')
    t.api.candles.mockRejectedValueOnce(new ApiError(500, 'boom'))
    t.ctl.onConnection('open')
    await vi.waitFor(() => expect(t.store.get().toast?.text).toBe('boom'))
    expect(t.store.get().drawings).toHaveLength(1)
    expect(t.store.get().rules).toHaveLength(1)
  })

  it('ignores a refresh whose answer arrives after the user moved to another symbol', async () => {
    const t = setup()
    await t.ctl.boot()
    t.ctl.onConnection('open'); t.ctl.onConnection('closed')
    let release: (v: unknown) => void = () => {}
    t.api.candles.mockImplementationOnce(() => new Promise((r) => { release = r }) as never)
    t.ctl.onConnection('open')
    const moved = t.ctl.selectSymbol(TCS)
    release({ symbol: SBIN, timeframe: '1H', forming: false, candles: [candle(H1 - 7200, 1, 2, 1, 1)] })
    await moved
    expect(t.store.get().symbol).toBe(TCS)
    expect(t.store.get().candles.some((c) => c.close === 1 && c.high === 2)).toBe(false)
  })
})

describe('live messages', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.ctl.boot()
  })

  it('a tick updates the quote board and moves the forming candle of the open chart', () => {
    t.ctl.onMessage({ type: 'tick', quote: quote(SBIN, 103.5) })
    expect(t.store.get().quotes[SBIN].price).toBe(103.5)
    expect(t.store.get().candles.at(-1)).toMatchObject({ close: 103.5, high: 103.5 })
  })

  it('a tick for another symbol updates the board but leaves the chart alone', () => {
    const before = t.store.get().candles
    t.ctl.onMessage({ type: 'tick', quote: quote(TCS, 3000) })
    expect(t.store.get().quotes[TCS].price).toBe(3000)
    expect(t.store.get().candles).toBe(before)
  })

  it('a closed bar from the server replaces the approximation', () => {
    t.ctl.onMessage({ type: 'tick', quote: quote(SBIN, 103) })
    t.ctl.onMessage({ type: 'bar_closed', symbol: SBIN, timeframe: '1H', bar: candle(H1, 100, 104, 99, 103.2, 555) })
    expect(t.store.get().candles.at(-1)).toEqual(candle(H1, 100, 104, 99, 103.2, 555))
  })

  it('a closed bar of a different timeframe is ignored', () => {
    const before = t.store.get().candles
    t.ctl.onMessage({ type: 'bar_closed', symbol: SBIN, timeframe: '5m', bar: candle(H1, 1, 1, 1, 1) })
    expect(t.store.get().candles).toBe(before)
  })

  it('a new signal is listed once and announced', () => {
    const signal: Signal = { id: 's1', rule_id: 'r1', symbol: SBIN, timeframe: '1H', side: 'BUY', bar_time: H1, entry: 101, stop: 99.6, target: 103.8, status: 'open', reason: '' }
    t.ctl.onMessage({ type: 'signal', signal })
    t.ctl.onMessage({ type: 'signal', signal })
    expect(t.store.get().signals).toEqual([signal])
    expect(t.store.get().toast).toMatchObject({ kind: 'success', text: 'Signal: BUY SBIN 1H @ 101.00' })
  })

  it('a rejected signal explains why', () => {
    t.ctl.onMessage({ type: 'signal', signal: { id: 's2', rule_id: 'r1', symbol: SBIN, timeframe: '1H', side: 'BUY', bar_time: H1, entry: 101, stop: null, target: null, status: 'rejected', reason: 'already in a position from this rule' } })
    expect(t.store.get().toast?.text).toContain('already in a position from this rule')
  })

  it('an opened position appears in the open list and its symbol is watched', () => {
    t.ctl.onMessage({ type: 'position', position: position({ symbol: 'NSE:INFY-EQ' }) })
    expect(t.store.get().positions.open).toHaveLength(1)
    expect(subscribed(t.socket)).toContain('NSE:INFY-EQ')
  })

  it('a stop hit moves the position to closed and says what it cost', () => {
    t.ctl.onMessage({ type: 'position', position: position() })
    t.ctl.onMessage({ type: 'position', position: position({ status: 'closed', exit_reason: 'stop', exit_price: 99.1, realized_pnl: -19 }) })
    const { open, closed } = t.store.get().positions
    expect(open).toEqual([])
    expect(closed).toHaveLength(1)
    expect(t.store.get().toast?.text).toBe('SBIN stop hit: -19.00')
  })

  it('an exit rule closing a trade is announced as such', () => {
    t.ctl.onMessage({ type: 'position', position: position() })
    t.ctl.onMessage({ type: 'position', position: position({ status: 'closed', exit_reason: 'exit_rule', exit_price: 103, realized_pnl: 20 }) })
    expect(t.store.get().toast?.text).toBe('SBIN exit rule met: +20.00')
  })

  it('feed status changes are tracked', () => {
    t.ctl.onMessage({ type: 'status', feed: 'reconnecting' })
    expect(t.store.get().feed).toBe('reconnecting')
  })

  it('server errors surface as a toast', () => {
    t.ctl.onMessage({ type: 'error', message: 'ignored invalid symbols' })
    expect(t.store.get().toast).toMatchObject({ kind: 'error', text: 'ignored invalid symbols' })
  })
})

describe('watchlists', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.ctl.boot()
  })

  it('reloading after a screener sync picks up a list the server created, opens it and starts streaming its symbols', async () => {
    t.api.watchlists.mockResolvedValueOnce([wl('w1', 'Watchlist', [SBIN, TCS]), wl('w9', 'Screen: Momentum', ['NSE:INFY-EQ'])])
    await t.ctl.reloadWatchlists('w9')
    expect(t.store.get().watchlists.map((w) => w.name)).toEqual(['Watchlist', 'Screen: Momentum'])
    expect(t.store.get().activeWatchlistId).toBe('w9')
    expect(subscribed(t.socket)).toContain('NSE:INFY-EQ')
  })

  it('reloading keeps the current list when it still exists, and falls back to the first when it is gone', async () => {
    t.api.watchlists.mockResolvedValueOnce([wl('w1', 'Watchlist', [SBIN]), wl('w9', 'Other', [])])
    await t.ctl.reloadWatchlists()
    expect(t.store.get().activeWatchlistId).toBe('w1')
    t.api.watchlists.mockResolvedValueOnce([wl('w9', 'Other', [])])
    await t.ctl.reloadWatchlists()
    expect(t.store.get().activeWatchlistId).toBe('w9')
  })

  it('a failed reload leaves the lists as they were', async () => {
    t.api.watchlists.mockRejectedValueOnce(new ApiError(500, 'boom'))
    await t.ctl.reloadWatchlists()
    expect(t.store.get().watchlists.map((w) => w.id)).toEqual(['w1'])
    expect(t.store.get().toast?.text).toBe('boom')
  })

  it('opening a watchlist selects it and goes back to the chart', () => {
    t.store.set({ view: 'strategies' })
    t.ctl.openWatchlist('w1')
    expect(t.store.get().view).toBe('chart')
    expect(t.store.get().activeWatchlistId).toBe('w1')
  })

  it('adding a symbol updates the list and starts streaming it', async () => {
    await t.ctl.addToWatchlist('NSE:HDFCBANK-EQ')
    expect(t.api.addToWatchlist).toHaveBeenCalledWith('w1', ['NSE:HDFCBANK-EQ'])
    expect(t.store.get().watchlists[0].symbols).toContain('NSE:HDFCBANK-EQ')
    expect(subscribed(t.socket)).toContain('NSE:HDFCBANK-EQ')
  })

  it('adding a duplicate just says so', async () => {
    t.api.addToWatchlist.mockResolvedValueOnce({ added: [], watchlist: wl('w1', 'Watchlist', [SBIN, TCS]) })
    await t.ctl.addToWatchlist(SBIN)
    expect(t.store.get().toast?.text).toBe('SBIN is already in Watchlist.')
  })

  it('removing a symbol stops streaming it unless it is still needed elsewhere', async () => {
    await t.ctl.removeFromWatchlist(TCS)
    expect(t.store.get().watchlists[0].symbols).toEqual([SBIN])
    expect(subscribed(t.socket)).toEqual([SBIN])
  })

  it('reordering shows immediately and rolls back if the server refuses', async () => {
    t.api.reorderWatchlist.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const p = t.ctl.reorderWatchlist([TCS, SBIN])
    expect(t.store.get().watchlists[0].symbols).toEqual([TCS, SBIN])
    await p
    expect(t.store.get().watchlists[0].symbols).toEqual([SBIN, TCS])
    expect(t.store.get().toast?.text).toBe('boom')
  })

  it('creating a watchlist selects it', async () => {
    await t.ctl.createWatchlist('Banks')
    expect(t.store.get().activeWatchlistId).toBe('w2')
    expect(t.store.get().watchlists.map((w) => w.name)).toEqual(['Watchlist', 'Banks'])
  })

  it('creates a watchlist pre-filled with symbols and subscribes to them', async () => {
    await t.ctl.createWatchlist('Banks', ['NSE:HDFCBANK-EQ'])
    expect(t.api.createWatchlist).toHaveBeenCalledWith('Banks', ['NSE:HDFCBANK-EQ'])
    expect(t.store.get().watchlists.find((w) => w.id === 'w2')?.symbols).toEqual(['NSE:HDFCBANK-EQ'])
  })

  it('the last watchlist cannot be deleted', async () => {
    await t.ctl.deleteWatchlist('w1')
    expect(t.api.deleteWatchlist).not.toHaveBeenCalled()
    expect(t.store.get().toast?.kind).toBe('info')
  })

  it('deleting the selected watchlist falls back to another', async () => {
    await t.ctl.createWatchlist('Banks')
    await t.ctl.deleteWatchlist('w2')
    expect(t.store.get().activeWatchlistId).toBe('w1')
  })
})

describe('drawings', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.ctl.boot()
  })

  it('a finished trend line is saved for the open symbol and selected', async () => {
    const points = [{ time: 1, price: 90 }, { time: 2, price: 95 }]
    t.ctl.setTool('trend_line')
    await t.ctl.addDrawing('trend_line', points)
    expect(t.api.createDrawing).toHaveBeenCalledWith({ symbol: SBIN, kind: 'trend_line', points })
    expect(t.store.get().drawings).toHaveLength(1)
    expect(t.store.get()).toMatchObject({ tool: 'cursor', selectedDrawingId: 'new1' })
  })

  it('a text note starts out labelled so it is visible straight away', async () => {
    const points = [{ time: 1, price: 90 }]
    await t.ctl.addDrawing('text', points)
    expect(t.api.createDrawing).toHaveBeenCalledWith({ symbol: SBIN, kind: 'text', points, label: 'Note' })
    await t.ctl.addDrawing('rectangle', [{ time: 1, price: 90 }, { time: 2, price: 95 }])
    expect(t.api.createDrawing).toHaveBeenLastCalledWith({ symbol: SBIN, kind: 'rectangle', points: [{ time: 1, price: 90 }, { time: 2, price: 95 }] })
  })

  it('dragging moves the line at once and keeps the server’s answer', async () => {
    t.store.set({ drawings: [line()] })
    const p = t.ctl.moveDrawing('d1', [{ time: H1, price: 105 }])
    expect(t.store.get().drawings[0].points[0].price).toBe(105)
    await p
    expect(t.api.updateDrawing).toHaveBeenCalledWith('d1', { points: [{ time: H1, price: 105 }] })
  })

  it('a failed move snaps the line back', async () => {
    t.store.set({ drawings: [line()] })
    t.api.updateDrawing.mockRejectedValueOnce(new ApiError(400, 'nope'))
    await t.ctl.moveDrawing('d1', [{ time: H1, price: 105 }])
    expect(t.store.get().drawings[0].points[0].price).toBe(100)
  })

  it('deleting a line used by a rule shows the server’s reason and keeps the line', async () => {
    t.store.set({ drawings: [line()] })
    t.api.deleteDrawing.mockRejectedValueOnce(new ApiError(409, 'this line is used by rule(s): Breakout. Delete or edit the rule first.'))
    await t.ctl.deleteDrawing('d1')
    expect(t.store.get().drawings).toHaveLength(1)
    expect(t.store.get().toast?.text).toContain('used by rule(s): Breakout')
  })

  it('deleting a line removes it and clears the selection', async () => {
    t.store.set({ drawings: [line()], selectedDrawingId: 'd1' })
    await t.ctl.deleteDrawing('d1')
    expect(t.store.get()).toMatchObject({ drawings: [], selectedDrawingId: null })
  })
})

describe('rules and positions', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await t.ctl.boot()
  })
  const draft = { symbol: SBIN, timeframe: '1H' as const, name: 'Breakout', side: 'BUY' as const, quantity: 10, enabled: true, once: false, condition: { type: 'compare' as const, op: '>' as const, a: { kind: 'close' as const }, b: { kind: 'value' as const, value: 1 } }, stop: { type: 'candle' as const, buffer_pct: 0 }, target: null }

  it('saving a rule closes the dialog and shows it in the Rules tab', async () => {
    t.ctl.openRuleDialog(draft)
    expect(await t.ctl.saveRule(draft)).toBe(true)
    expect(t.store.get()).toMatchObject({ ruleDialog: null, dock: 'rules' })
    expect(t.store.get().rules).toHaveLength(1)
    expect(t.store.get().toast?.text).toContain('completed candles')
  })

  it('a rule the server rejects keeps the dialog open with the reason', async () => {
    t.api.saveRule.mockRejectedValueOnce(new ApiError(400, 'quantity must be a positive whole number'))
    t.ctl.openRuleDialog(draft)
    expect(await t.ctl.saveRule(draft)).toBe(false)
    expect(t.store.get().ruleDialog).not.toBeNull()
    expect(t.store.get().toast?.text).toBe('quantity must be a positive whole number')
  })

  it('editing replaces the rule instead of adding another', async () => {
    await t.ctl.saveRule(draft)
    await t.ctl.saveRule({ ...draft, id: 'r1', quantity: 25 })
    expect(t.store.get().rules).toHaveLength(1)
    expect(t.store.get().rules[0].quantity).toBe(25)
  })

  it('closing a position at market moves it to history', async () => {
    t.ctl.onMessage({ type: 'position', position: position() })
    await t.ctl.closePosition('p1')
    expect(t.store.get().positions.open).toEqual([])
    expect(t.store.get().positions.closed[0]).toMatchObject({ exit_reason: 'manual', realized_pnl: 30 })
  })

  it('toggling and deleting a rule', async () => {
    await t.ctl.saveRule(draft)
    await t.ctl.toggleRule('r1', false)
    expect(t.store.get().rules[0].enabled).toBe(false)
    await t.ctl.deleteRule('r1')
    expect(t.store.get().rules).toEqual([])
  })
})

describe('indicators', () => {
  it('can be added once and removed', async () => {
    const t = setup()
    await t.ctl.boot()
    t.ctl.addIndicator('bollinger')
    t.ctl.addIndicator('bollinger')
    expect(t.store.get().indicators.map((i) => i.id)).toEqual(['ema-20', 'bollinger-20-2'])
    t.ctl.removeIndicator('ema-20')
    expect(t.store.get().indicators.map((i) => i.name)).toEqual(['bollinger'])
  })
})
