// Shapes exchanged with the trading-service /terminal API (see trading_service/terminal/api.py).

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1H' | '2H' | '4H' | '1D' | '1W'
export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1H', '2H', '4H', '1D', '1W']

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }

export type Quote = {
  symbol: string
  price: number
  ts: number
  prev_close: number | null
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  change: number | null
  change_pct: number | null
}

export type DrawingKind = 'trend_line' | 'ray' | 'horizontal_line' | 'rectangle' | 'text'
/** A rectangle is a zone; a rule reads one of its two horizontal edges as a level. */
export type Edge = 'top' | 'bottom'
export type DrawingPoint = { time: number; price: number }
export type Drawing = {
  id: string
  symbol: string
  kind: DrawingKind
  points: DrawingPoint[]
  style: { color?: string }
  label: string
}
export type NewDrawing = Pick<Drawing, 'symbol' | 'kind' | 'points'> & Partial<Pick<Drawing, 'style' | 'label'>>

// ---- rules -------------------------------------------------------------
export type PriceKind = 'open' | 'high' | 'low' | 'close' | 'volume'
export type Operand =
  | { kind: PriceKind }
  | { kind: 'value'; value: number }
  | { kind: 'line'; drawing_id: string; edge?: Edge }
  /** The extreme of the PREVIOUS `bars` candles (a range breakout level). */
  | { kind: 'highest' | 'lowest'; bars: number; source: PriceKind }
  | { kind: 'indicator'; name: IndicatorName; params: Record<string, number>; output: string }

export type Condition =
  | { type: 'cross'; direction: 'above' | 'below'; a: Operand; b: Operand }
  | { type: 'compare'; op: '>' | '>=' | '<' | '<='; a: Operand; b: Operand }
  /** True when the candle being judged closed inside this IST window ('HH:MM'). */
  | { type: 'time_between'; start: string; end: string }
  | { type: 'all' | 'any'; conditions: Condition[] }

export type StopSpec =
  | { type: 'fixed'; price: number }
  | { type: 'pct'; value: number }
  | { type: 'atr'; period: number; mult: number }
  | { type: 'candle'; buffer_pct: number }
  | { type: 'line'; drawing_id: string; edge?: Edge }

/** A trailing stop: re-evaluated on every completed candle of `timeframe` (default: the rule's own) and only ever
 *  tightened. The server copies it onto the position when it opens. */
export type TrailSpec = (
  | { type: 'candle'; bars: number; buffer_pct: number }
  | { type: 'atr'; period: number; mult: number }
  | { type: 'pct'; value: number }
  | { type: 'indicator'; name: IndicatorName; params: Record<string, number>; output: string }
  | { type: 'line'; drawing_id: string; edge?: Edge }
) & { timeframe?: Timeframe }

export type TargetSpec = { type: 'rr'; ratio: number } | { type: 'pct'; value: number } | { type: 'fixed'; price: number }

export type Rule = {
  id: string
  symbol: string
  timeframe: Timeframe
  name: string
  side: 'BUY' | 'SELL'
  condition: Condition
  stop: StopSpec
  target: TargetSpec | null
  quantity: number
  enabled: boolean
  once: boolean
  trail?: TrailSpec | null
  exit_condition?: Condition | null
  exit_timeframe?: Timeframe | null
  exit_condition_2?: Condition | null
  exit_timeframe_2?: Timeframe | null
}
export type RuleDraft = Omit<Rule, 'id'> & { id?: string }

export type Signal = {
  id: string
  rule_id: string | null
  symbol: string
  timeframe: Timeframe
  side: 'BUY' | 'SELL'
  bar_time: number
  entry: number
  stop: number | null
  target: number | null
  status: 'open' | 'rejected'
  reason: string
}

export type Position = {
  id: string
  source: 'paper'
  signal_id: string | null
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: number
  entry_price: number
  stop: number | null
  target: number | null
  status: 'open' | 'closed'
  opened_at: number
  closed_at: number | null
  exit_price: number | null
  exit_reason: 'stop' | 'target' | 'manual' | 'exit_rule' | null
  realized_pnl: number | null
  initial_stop?: number | null
  trail?: TrailSpec | null
  exit_condition?: Condition | null
  exit_timeframe?: Timeframe | null
  exit_condition_2?: Condition | null
  exit_timeframe_2?: Timeframe | null
  exit_level?: 1 | 2
  exit_qty_1?: number | null
  exit_price_1?: number | null
  exit_pnl_1?: number | null
  last_price?: number
  unrealized_pnl?: number
}

export type Watchlist = { id: string; name: string; symbols: string[] }
export type SymbolHit = { symbol: string; exchange: string; name: string; sector: string }

// ---- financials ---------------------------------------------------------
export type FinancialRow = {
  period: string
  period_end_date: string | null
  revenue: number | null
  expenses: number | null
  operating_profit: number | null
  opm_pct: number | null
  other_income: number | null
  interest: number | null
  depreciation: number | null
  profit_before_tax: number | null
  tax: number | null
  net_profit: number | null
  npm_pct: number | null
  eps: number | null
  revenue_growth_pct: number | null
  profit_growth_pct: number | null
}
/** One announced result, for the chart marker. `reaction_pct`: next session's close vs the close on result day. */
export type FinancialEvent = {
  date: string
  quarter: string
  net_profit: number | null
  eps: number | null
  revenue_growth_pct: number | null
  profit_growth_pct: number | null
  reaction_pct: number | null
}
/** Trailing-twelve-month EPS, effective from `time` (epoch seconds) until the next point. */
export type EpsPoint = { time: number; value: number; period: string; estimated: boolean }
export type Financials = {
  symbol: string
  available: boolean
  company: string
  quarterly: FinancialRow[]
  annual: FinancialRow[]
  ratios: Record<string, number | null>
  announcements: { result_date: string | null; quarter: string }[]
  events: FinancialEvent[]
  eps_ttm: EpsPoint[]
}
export type RecentResult = {
  symbol: string
  company: string
  result_date: string | null
  quarter: string
  revenue: number | null
  net_profit: number | null
  opm_pct: number | null
  eps: number | null
  revenue_growth_pct: number | null
  profit_growth_pct: number | null
}

// ---- sectors ------------------------------------------------------------
export type SectorGroup = { name: string; count: number; sectors: { name: string; count: number }[] }
export type SectorColumn = { key: string; label: string; higher_is_better: boolean | null }
export type SectorRow = { symbol: string; name: string; sector: string; group: string; metrics: Record<string, number | null>; ranks: Record<string, number> }
export type SectorCompare = {
  group: string; sector: string | null; count: number
  columns: SectorColumn[]; medians: Record<string, number>; ranked: Record<string, number>
  symbols: string[]; rows: SectorRow[]
}

// ---- screener -----------------------------------------------------------
export type ScreenFilter = { field: string; op: string; value: number | { field: string } }
export type ScreenRow = { symbol: string; name: string | null; sector: string | null; market_cap: number | null; asof: string | null } & Record<string, number | string | null>
export type ScreenResult = { run_date: string | null; count: number; rows: ScreenRow[]; preset?: string }
export type Preset = { name: string; label: string; description: string; filters: ScreenFilter[]; sort: string; descending: boolean; group?: string; show?: string[] }
export type ScreenColumn = { name: string; label: string; unit?: string; short?: string }

// ---- strategy-screener -> watchlist ---------------------------------------
export type SyncFilter = { source: 'ratio' | 'quarter' | 'year'; metric: string; op: '>' | '>=' | '<' | '<='; value: number; on_missing?: 'keep' | 'drop' }
export type SyncSettings = { strategy_id: number; tolerance_pct: number; max_failing: number; max_symbols: number; filters: SyncFilter[]; name?: string }
export type SyncStrategy = { id: number; name: string; description: string; is_active: boolean; market_type: string; timeframe: string; conditions: string[] }
export type SyncCandidate = {
  symbol: string; status: 'matched' | 'near'; gap_pct: number; reason: string; close: number | null; change_pct: number | null
  company: string; sector: string; market_cap: number; notes: string[]
}
export type SyncPlan = {
  strategy_id: number; strategy_name: string; conditions: string[]; tolerance_pct: number; max_failing: number; max_symbols: number
  filters: SyncFilter[]; asof: string | null; scanned: number; matched_total: number; near_total: number
  rejected_by_financials: number; truncated: boolean; candidates: SyncCandidate[]
}
export type SyncResult = {
  watchlist: Watchlist; created: boolean; added: string[]; removed: string[]; kept_for_trading: string[]
  matched: number; near: number; truncated: boolean; asof: string | null; plan: SyncPlan
}
export type SyncLink = {
  watchlist_id: string; watchlist_name: string; strategy_id: number; strategy_name: string; tolerance_pct: number; max_failing: number
  max_symbols: number; filters: SyncFilter[]; last_run_at: string | null; last_asof: string | null; matched_count: number; near_count: number
  members: { symbol: string; status: 'matched' | 'near'; gap_pct: number | null; reason: string; managed: boolean }[]
}

// ---- indicators ---------------------------------------------------------
export type IndicatorName = 'sma' | 'ema' | 'rsi' | 'atr' | 'bollinger' | 'macd' | 'supertrend' | 'stochastic' | 'cci' | 'williams_r' | 'adx' | 'donchian' | 'keltner' | 'roc' | 'psar'

// ---- websocket ----------------------------------------------------------
export type ServerStatus = { mode: string; feed: string; now: number; subscribed: string[]; clients: number }
export type ServerMessage =
  | ({ type: 'hello' } & ServerStatus)
  | { type: 'tick'; quote: Quote }
  | { type: 'bar_closed'; symbol: string; timeframe: Timeframe; bar: Candle }
  | { type: 'signal'; signal: Signal }
  | { type: 'position'; position: Position }
  | { type: 'status'; feed: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// ---- backtests ---------------------------------------------------------------
export type BacktestSummary = {
  initial_capital: number; final_equity: number; return_pct: number; realized_pnl: number; unrealized_pnl: number; fees: number
  trades: number; open_positions: number; wins: number; losses: number; win_rate_pct: number | null
  avg_win: number | null; avg_loss: number | null; profit_factor: number | null; max_drawdown_pct: number; cash: number
}
export type BacktestTrade = {
  symbol: string; side: 'BUY' | 'SELL'; quantity: number; entry_time: string; entry_price: number
  exit_time: string; exit_price: number | null; exit_reason: string | null; pnl: number; pnl_pct: number; initial_stop: number | null
}
export type BacktestOpen = {
  symbol: string; side: 'BUY' | 'SELL'; quantity: number; entry_time: string; entry_price: number
  stop: number | null; target: number | null; last_price: number; unrealized_pnl: number
}
export type BacktestReport = {
  summary: BacktestSummary
  equity: { date: string; equity: number; open: number }[]
  trades: BacktestTrade[]
  open: BacktestOpen[]
  rejected: Record<string, number>
  universe: { date: string; count: number; added: string[]; removed: string[] }[]
  no_data: string[]
  notes: string[]
}
export type BacktestParams = { start: string; end: string; capital: number; allocation_pct: number; max_positions: number | null; cost_pct: number; rescreen_days: number }
export type BacktestRow = {
  id: string; account: string; status: 'running' | 'done' | 'failed'; progress: string | null; error: string | null
  params: BacktestParams; summary: BacktestSummary | null; created_at: string; finished_at: string | null
}
export type BacktestFull = Omit<BacktestRow, 'summary'> & { result: BacktestReport | null }
/** Which stocks to run on: exactly one of symbols, watchlist_id, screen. */
export type BacktestRequest = {
  start: string; end: string; capital: number; allocation_pct: number; rule_ids: string[]
  max_positions?: number; cost_pct?: number; rescreen_days?: number
  symbols?: string[]; watchlist_id?: string; screen?: { preset: string; limit?: number }
}

// ---- data health and scrape jobs --------------------------------------------------
export type DataStatus = {
  symbols?: { total: number; with_sector: number; with_market_cap: number }
  changes?: { added: string[]; removed: string[]; added_total: number; removed_total: number } | null
  ohlcv_1d?: { symbols: number; latest: string | null; oldest: string | null; symbols_on_latest: number }
  financials?: { companies: number; latest_scraped: string | null }
  results?: { total: number; latest: string | null; last_7_days: number }
}
/** A parameter is either a list of allowed words or a [min, max] range of whole numbers. */
export type DataJobDef = { id: string; label: string; help: string; params: Record<string, string[] | [number, number]> }
export type DataJobState = { status: string; started_at?: string | null; finished_at?: string | null; progress?: string; error?: string | null }
export type DataOverview = { status: DataStatus; catalog: DataJobDef[]; jobs: Record<string, DataJobState> | null; jobs_error: string | null }
