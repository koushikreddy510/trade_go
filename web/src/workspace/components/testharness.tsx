// Shared by the component tests: a real store and controller wired to a fake API and
// socket, plus small builders for the data the screens show.
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import type {
  BacktestFull, BacktestReport, DataOverview, BacktestRow, BacktestSummary, Candle, Drawing, FinancialRow, Financials, Position, Preset, Quote, RecentResult, Rule, ScreenResult, SectorCompare, SectorGroup, SectorRow, Signal, SyncCandidate, SyncLink, SyncPlan, SyncResult, SyncStrategy, Watchlist,
} from '../api/types'
import { candle, ist } from '../lib/testutil'
import { Controller } from '../store/controller'
import { createStore } from '../store/store'
import { initialState, type AppState } from '../store/state'
import { AppContext, type AppContextValue } from './context'

export const SBIN = 'NSE:SBIN-EQ'
export const TCS = 'NSE:TCS-EQ'
export const T0 = ist(2026, 10, 19, 9, 15)

export const wl = (id: string, name: string, symbols: string[]): Watchlist => ({ id, name, symbols })
export const quote = (symbol: string, price: number, prev = 100): Quote => ({
  symbol, price, ts: T0, prev_close: prev, open: null, high: null, low: null, volume: null, change: price - prev, change_pct: ((price - prev) / prev) * 100,
})
export const position = (over: Partial<Position> = {}): Position => ({
  id: 'p1', source: 'paper', signal_id: 's1', symbol: SBIN, side: 'BUY', quantity: 10, entry_price: 100, stop: 95, target: 110, status: 'open',
  opened_at: T0, closed_at: null, exit_price: null, exit_reason: null, realized_pnl: null, ...over,
})
export const line = (over: Partial<Drawing> = {}): Drawing => ({ id: 'd1', symbol: SBIN, kind: 'trend_line', points: [{ time: T0, price: 100 }, { time: T0 + 3600, price: 104 }], style: {}, label: '', ...over })
export const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1', symbol: SBIN, timeframe: '1H', name: 'Breakout', side: 'BUY', quantity: 5, enabled: true, once: false,
  condition: { type: 'cross', direction: 'above', a: { kind: 'close' }, b: { kind: 'line', drawing_id: 'd1' } },
  stop: { type: 'candle', buffer_pct: 0 }, target: { type: 'rr', ratio: 2 }, ...over,
})
export const signal = (over: Partial<Signal> = {}): Signal => ({
  id: 's1', rule_id: 'r1', symbol: SBIN, timeframe: '1H', side: 'BUY', bar_time: T0, entry: 101, stop: 99, target: 105, status: 'open', reason: '', ...over,
})
export const row = (period: string, over: Partial<FinancialRow> = {}): FinancialRow => ({
  period, period_end_date: null, revenue: 1000, expenses: 800, operating_profit: 200, opm_pct: 20, other_income: 0, interest: 0, depreciation: 0,
  profit_before_tax: 190, tax: 40, net_profit: 150, npm_pct: 15, eps: 12.5, revenue_growth_pct: 5, profit_growth_pct: -3, ...over,
})
export const financials = (over: Partial<Financials> = {}): Financials => ({
  symbol: SBIN, available: true, company: 'State Bank of India', quarterly: [row('Jun 2026'), row('Sep 2026', { revenue: 1200 })], annual: [row('Mar 2026', { revenue: 4800 })],
  ratios: { pe_ratio: 9.5, roe_pct: 17.2, market_cap_cr: 700000, pb_ratio: null }, announcements: [{ result_date: '2026-11-05', quarter: 'Sep 2026' }], events: [], eps_ttm: [], ...over,
})
export const preset = (name: string, over: Partial<Preset> = {}): Preset => ({ name, label: name, description: `${name} stocks`, filters: [], sort: 'ret_60d', descending: true, ...over })
export const screenRow = (symbol: string, over: Record<string, number | string | null> = {}) => ({
  symbol, name: symbol.split(':')[1], sector: 'Banks', market_cap: 1000, asof: '2026-10-16', close: 100, change_pct: 1.5, volume_ratio: 2.1, rsi_14: 55, ret_20d: 4, ret_60d: 9, pct_from_52w_high: -2, ...over,
})
export const screen = (rows: ReturnType<typeof screenRow>[], over: Partial<ScreenResult> = {}): ScreenResult => ({ run_date: '2026-10-16', count: rows.length, rows: rows as ScreenResult['rows'], ...over })
export const recent = (symbol: string, over: Partial<RecentResult> = {}): RecentResult => ({
  symbol, company: symbol, result_date: '2026-10-17', quarter: 'Sep 2026', revenue: 500, net_profit: 60, opm_pct: 18.2, eps: 3.4, revenue_growth_pct: 8, profit_growth_pct: -12, ...over,
})

export const syncStrategy = (over: Partial<SyncStrategy> = {}): SyncStrategy => ({
  id: 7, name: 'Momentum', description: '', is_active: true, market_type: 'stocks', timeframe: '1D', conditions: ['RSI(14) > 60', 'EMA(20) < close'], ...over,
})
export const candidate = (symbol: string, over: Partial<SyncCandidate> = {}): SyncCandidate => ({
  symbol, status: 'matched', gap_pct: 0, reason: 'meets every condition', close: 100, change_pct: 1.2, company: symbol.split(':')[1], sector: 'Banks', market_cap: 1000, notes: [], ...over,
})
export const syncPlan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
  strategy_id: 7, strategy_name: 'Momentum', conditions: ['RSI(14) > 60', 'EMA(20) < close'], tolerance_pct: 3, max_failing: 1, max_symbols: 100, filters: [],
  asof: '2026-10-16', scanned: 1800, matched_total: 1, near_total: 1, rejected_by_financials: 0, truncated: false,
  candidates: [candidate(SBIN), candidate(TCS, { status: 'near', gap_pct: 1.7, reason: 'RSI(14) 59 is 1.7% below 60' })], ...over,
})
export const syncLink = (over: Partial<SyncLink> = {}): SyncLink => ({
  watchlist_id: 'w9', watchlist_name: 'Screen: Momentum', strategy_id: 7, strategy_name: 'Momentum', tolerance_pct: 3, max_failing: 1, max_symbols: 100, filters: [],
  last_run_at: '2026-10-19T13:00:00Z', last_asof: '2026-10-16', matched_count: 1, near_count: 1, members: [], ...over,
})
export const syncResult = (over: Partial<SyncResult> = {}): SyncResult => ({
  watchlist: wl('w9', 'Screen: Momentum', [SBIN, TCS]), created: true, added: [SBIN, TCS], removed: [], kept_for_trading: [], matched: 1, near: 1, truncated: false, asof: '2026-10-16', plan: syncPlan(), ...over,
})

export const sectorGroup = (name: string, sectors: [string, number][]): SectorGroup => ({ name, count: sectors.reduce((n, [, c]) => n + c, 0), sectors: sectors.map(([n, c]) => ({ name: n, count: c })) })
const COLUMNS: SectorCompare['columns'] = [
  { key: 'market_cap_cr', label: 'Market cap (Cr)', higher_is_better: true }, { key: 'pe_ratio', label: 'P/E', higher_is_better: false },
  { key: 'roe_pct', label: 'ROE %', higher_is_better: true }, { key: 'ret_20d', label: '1 month %', higher_is_better: true }, { key: 'rsi_14', label: 'RSI 14', higher_is_better: null },
]
export const sectorRow = (symbol: string, metrics: Record<string, number | null>, ranks: Record<string, number>): SectorRow => ({ symbol, name: symbol.slice(4, -3) + ' Ltd', sector: 'Private Sector Bank', group: 'Banking & Finance', metrics, ranks })
export const sectorCompare = (over: Partial<SectorCompare> = {}): SectorCompare => ({
  group: 'Banking & Finance', sector: null, count: 3, columns: COLUMNS, medians: { market_cap_cr: 900000, pe_ratio: 17, roe_pct: 17.5, ret_20d: 3 }, ranked: { market_cap_cr: 3, pe_ratio: 3, roe_pct: 3, ret_20d: 3 },
  symbols: ['NSE:HDFCBANK-EQ', 'NSE:ICICIBANK-EQ', 'NSE:SBIN-EQ'],
  rows: [
    sectorRow('NSE:HDFCBANK-EQ', { market_cap_cr: 1200000, pe_ratio: 18, roe_pct: 16, ret_20d: 3, rsi_14: 58 }, { market_cap_cr: 1, pe_ratio: 3, roe_pct: 3, ret_20d: 2 }),
    sectorRow('NSE:ICICIBANK-EQ', { market_cap_cr: 900000, pe_ratio: 17, roe_pct: 17.5, ret_20d: 5, rsi_14: 64 }, { market_cap_cr: 2, pe_ratio: 2, roe_pct: 2, ret_20d: 1 }),
    sectorRow('NSE:SBIN-EQ', { market_cap_cr: 700000, pe_ratio: 9, roe_pct: 18, ret_20d: -2, rsi_14: null }, { market_cap_cr: 3, pe_ratio: 1, roe_pct: 1, ret_20d: 3 }),
  ], ...over,
})

export const btSummary = (over: Partial<BacktestSummary> = {}): BacktestSummary => ({
  initial_capital: 1000000, final_equity: 1100000, return_pct: 10, realized_pnl: 80000, unrealized_pnl: 20000, fees: 0, trades: 2, open_positions: 1,
  wins: 1, losses: 1, win_rate_pct: 50, avg_win: 90000, avg_loss: -10000, profit_factor: 9, max_drawdown_pct: 3.5, cash: 900000, ...over,
})
export const btReport = (over: Partial<BacktestReport> = {}): BacktestReport => ({
  summary: btSummary(),
  equity: [{ date: '2025-10-01', equity: 1000000, open: 0 }, { date: '2025-10-02', equity: 980000, open: 1 }, { date: '2025-10-03', equity: 1100000, open: 1 }],
  trades: [
    { symbol: 'NSE:SBIN-EQ', side: 'BUY', quantity: 100, entry_time: '2025-10-01T09:45:00+00:00', entry_price: 800, exit_time: '2025-10-02T09:45:00+00:00', exit_price: 890, exit_reason: 'target', pnl: 9000, pnl_pct: 11.25, initial_stop: 760 },
    { symbol: 'NSE:TCS-EQ', side: 'BUY', quantity: 10, entry_time: '2025-10-02T09:45:00+00:00', entry_price: 3000, exit_time: '2025-10-03T09:45:00+00:00', exit_price: 2900, exit_reason: 'exit_rule', pnl: -1000, pnl_pct: -3.33, initial_stop: 2800 },
  ],
  open: [{ symbol: 'NSE:INFY-EQ', side: 'BUY', quantity: 50, entry_time: '2025-10-03T09:45:00+00:00', entry_price: 1500, stop: 1450, target: null, last_price: 1520, unrealized_pnl: 1000 }],
  rejected: { 'not enough cash for one share': 2 }, universe: [{ date: '2025-10-01', count: 3, added: [], removed: [] }], no_data: [], notes: ['Positions still open are marked at the last close, not squared off.'], ...over,
})
const btParams = { start: '2025-10-01', end: '2025-10-03', capital: 1000000, allocation_pct: 10, max_positions: null, cost_pct: 0, rescreen_days: 7 }
export const btRow = (over: Partial<BacktestRow> = {}): BacktestRow => ({
  id: 'b1', account: 'default', status: 'done', progress: null, error: null, params: btParams, summary: btSummary(), created_at: '2026-10-19T10:00:00+00:00', finished_at: '2026-10-19T10:01:00+00:00', ...over,
})
export const btFull = (over: Partial<BacktestFull> = {}): BacktestFull => ({
  id: 'b1', account: 'default', status: 'done', progress: null, error: null, params: btParams, result: btReport(), created_at: '2026-10-19T10:00:00+00:00', finished_at: '2026-10-19T10:01:00+00:00', ...over,
})

export const dataOverview = (over: Partial<DataOverview> = {}): DataOverview => ({
  status: {
    symbols: { total: 100, with_sector: 80, with_market_cap: 90 }, changes: { added: ['NSE:NEW-EQ'], removed: [], added_total: 1, removed_total: 0 },
    ohlcv_1d: { symbols: 99, latest: '2026-10-16', oldest: '2020-01-01', symbols_on_latest: 95 }, financials: { companies: 30, latest_scraped: '2026-10-15T10:00:00' }, results: { total: 500, latest: '2026-10-14', last_7_days: 12 },
  },
  catalog: [
    { id: 'financials', label: 'Financials (screener.in)', help: 'Quarterly and yearly results.', params: { mode: ['incremental', 'announcements_only', 'full'], limit: [0, 5000] } },
    { id: 'sectors', label: 'Sectors and market cap (NSE)', help: 'Fills industries.', params: {} },
  ],
  jobs: { financials: { status: 'completed', finished_at: '2026-10-15T10:30:00' } }, jobs_error: null, ...over,
})

export function makeApp(over: Record<string, unknown> = {}, initial: Partial<AppState> = {}) {
  const candles: Candle[] = [candle(T0 - 3600, 99, 101, 98, 100), candle(T0, 100, 102, 99, 101)]
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
    saveRule: vi.fn(async (d: Partial<Rule>) => ({ ...rule(), ...d, id: d.id ?? 'r-new' }) as Rule),
    setRuleEnabled: vi.fn(async (id: string, enabled: boolean) => rule({ id, enabled })),
    deleteRule: vi.fn(async () => undefined),
    signals: vi.fn(async () => [] as Signal[]),
    positions: vi.fn(async () => ({ open: [] as Position[], closed: [] as Position[] })),
    closePosition: vi.fn(async (id: string) => position({ id, status: 'closed', exit_reason: 'manual', exit_price: 104, realized_pnl: 40 })),
    financials: vi.fn(async (symbol: string) => ({ ...financials({ available: false, company: '', quarterly: [], annual: [], ratios: {}, announcements: [] }), symbol })),
    searchSymbols: vi.fn(async () => [] as { symbol: string; exchange: string; name: string; sector: string }[]),
    brokers: vi.fn(async () => [
      { broker: 'flattrade' as const, status: 'rejected', detail: 'Session Expired', auto_login: true, has_api_key: true, obtained_at: '2026-10-20T02:15:00Z', source: 'auto' as const, login_url: 'https://auth.flattrade.in/?app_key=k' },
      { broker: 'paytm' as const, status: 'not_configured', detail: '', auto_login: false, has_api_key: false, obtained_at: null, source: null, login_url: null },
    ]),
    brokerLogin: vi.fn(async (broker: string) => ({ broker, source: 'auto', obtained_at: '2026-10-21T02:15:00Z' })),
    liveSettings: vi.fn(async () => ({ kill_switch: false, accounts: { flattrade: { live_enabled: false, max_order_value: 20000, max_orders_per_day: 20 } } })),
    liveOrders: vi.fn(async () => [] as unknown[]),
    livePositions: vi.fn(async () => [] as unknown[]),
    rulesWatch: vi.fn(async () => [] as unknown[]),
    allDrawings: vi.fn(async () => [] as unknown[]),
    approvals: vi.fn(async () => [] as unknown[]),
    decideApproval: vi.fn(async (id: string, approve: boolean) => ({ id, status: approve ? 'approved' : 'rejected' })),
    placeOrder: vi.fn(async function (this: unknown, req: { symbol: string; side: 'BUY' | 'SELL'; quantity: number; product: string }) {
      const order = { id: 'o1', account: 'flattrade', symbol: req.symbol, side: req.side, quantity: req.quantity, units: req.quantity, product: req.product,
        price: 967.6, status: 'open', broker_order_id: 'B1', filled_units: 0, avg_price: null, message: null, source: 'ticket', created_at: '2026-10-21T09:20:00Z' }
      api.liveOrders.mockResolvedValue([order])
      return order
    }),
    cancelOrder: vi.fn(async (id: string) => ({ id, status: 'cancelled' })),
    moveStop: vi.fn(async (id: string, trigger_price: number) => ({ id, status: 'open', trigger_price })),
    setLiveSettings: vi.fn(async () => ({ live_enabled: true, max_order_value: 20000, max_orders_per_day: 20 })),
    killSwitch: vi.fn(async (on: boolean) => ({ kill_switch: on })),
    funds: vi.fn(async () => ({ cash: 15000, payin: 0, collateral: 0, margin_used: 0, available: 15000, payout: 0, blocked: 0 })),
    products: vi.fn(async () => ({
      MCX: [{ prd: 'M', name: 'NRML', listed: true }, { prd: 'I', name: 'Intraday', listed: true }],
      NSE: [{ prd: 'F', name: 'MTF', listed: false }, { prd: 'I', name: 'Intraday', listed: true }],
    })),
    quote: vi.fn(async (symbol: string) => ({
      symbol, ltp: 211200, prev_close: 213900, change: -2700, change_pct: -1.26, open: 213000, high: 213500, low: 211000,
      bid: 211190, bid_qty: 3, ask: 211210, ask_qty: 5, upper_circuit: 222000, lower_circuit: 205000, volume: 23384, oi: 1200,
      lot_size: 5, tick_size: 1, expiry: '30-NOV-2026', instrument: 'FUTCOM', point_value: 5, quantity_unit: 'lots' as const,
      is_index: symbol.endsWith('-INDEX'),
      sector: symbol === 'NSE:INFY-EQ' ? 'Computers - Software & Consulting' : null,
      sector_index: symbol === 'NSE:INFY-EQ' ? 'NSE:NIFTYIT-INDEX' : null,
    })),
    orderPreview: vi.fn(async (req: { symbol: string; side: 'BUY' | 'SELL'; quantity: number }) => ({
      ...req, product: 'M', product_name: 'NRML', price_type: 'LMT' as const, price: 211200, units: req.quantity * 5, quantity_unit: 'lots' as const,
      lot_size: 5, contract_value: 211200 * 5 * req.quantity, margin_required: 30259.8 * req.quantity, available: 15000,
      shortfall: Math.max(0, 30259.8 * req.quantity - 15000), broker_remarks: 'Insufficient Balance', existing_position: null, quote: null, preview_only: true as const,
    })),
    presets: vi.fn(async () => [preset('uptrend'), preset('oversold', { sort: 'rsi_14', descending: false })]),
    columns: vi.fn(async () => ({ columns: [{ name: 'rsi_14', label: 'RSI 14' }, { name: 'close', label: 'Last close' }, { name: 'sma_200', label: 'SMA 200' }], operators: ['>', '>=', '<', '<=', '=', '!='] })),
    runPreset: vi.fn(async () => screen([screenRow(SBIN), screenRow(TCS, { change_pct: -1 })])),
    runScreen: vi.fn(async () => screen([screenRow(SBIN)])),
    runScan: vi.fn(async () => ({ run_date: '2026-10-19', scanned: 10, stored: 9, skipped: 1 })),
    recentResults: vi.fn(async () => [recent('NSE:INFY-EQ')]),
    dataStatus: vi.fn(async () => dataOverview()),
    runDataJob: vi.fn(async () => ({ job_id: 'financials', status: 'started' })),
    startBacktest: vi.fn(async () => 'b1'),
    backtests: vi.fn(async () => [btRow()]),
    backtest: vi.fn(async () => btFull()),
    deleteBacktest: vi.fn(async () => undefined),
    sectors: vi.fn(async () => [sectorGroup('Banking & Finance', [['Private Sector Bank', 2], ['Public Sector Bank', 1]]), sectorGroup('IT & Technology', [['Software Products', 4]])]),
    compareSector: vi.fn(async (p: { group?: string; sector?: string }) => sectorCompare(p.sector ? { sector: p.sector } : {})),
    syncStrategies: vi.fn(async () => [syncStrategy()]),
    syncLinks: vi.fn(async () => [] as SyncLink[]),
    syncPreview: vi.fn(async () => syncPlan()),
    syncApply: vi.fn(async () => syncResult()),
    syncRefresh: vi.fn(async () => [{ strategy_id: 7, ok: true, added: 0, removed: 0 }]),
    syncUnlink: vi.fn(async () => undefined),
    ...over,
  }
  const socket = { setSymbols: vi.fn(), connect: vi.fn(), close: vi.fn() }
  const store = createStore<AppState>({ ...initialState, ...initial })
  const ctl = new Controller(api as never, socket, store, null)
  const ctx = { store, ctl, api: api as never } as AppContextValue
  return { api, socket, store, ctl, ctx, candles }
}

export type App = ReturnType<typeof makeApp>

export function renderIn(ui: ReactElement, app: App) {
  return render(<AppContext.Provider value={app.ctx}>{ui}</AppContext.Provider>)
}
