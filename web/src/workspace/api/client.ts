import type {
  BacktestFull, BrokerQuote, BrokerStatus, DataOverview, Funds, OrderPreview, OrderPreviewRequest, ProductChoice, ScreenColumn, BacktestRequest, BacktestRow, Candle, Drawing, Financials, NewDrawing, Position, Preset, RecentResult, Rule, RuleDraft, ScreenFilter, ScreenResult,
  SectorCompare, SectorGroup, ServerStatus, Signal, SymbolHit, SyncLink, SyncPlan, SyncResult, SyncSettings, SyncStrategy, Timeframe, Watchlist,
} from './types'
import { draftToPayload } from '../lib/rules'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

type Fetch = typeof fetch

/** Thin typed wrapper over the /terminal REST API. Errors carry the server's readable message. */
export class ApiClient {
  constructor(private base = '/terminal', private fetchImpl: Fetch = (...a) => fetch(...a)) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return undefined as T
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const detail = (data as { detail?: unknown } | null)?.detail
      throw new ApiError(res.status, typeof detail === 'string' ? detail : `Request failed (${res.status})`)
    }
    return data as T
  }

  private qs(params: Record<string, string | number | undefined>): string {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
    const s = q.toString()
    return s ? `?${s}` : ''
  }

  status = () => this.request<ServerStatus>('GET', '/status')
  brokers = async () => (await this.request<{ brokers: BrokerStatus[] }>('GET', '/brokers')).brokers
  /** Log in now: unattended when `code` is left out, else with the URL the broker's login page redirected to. */
  brokerLogin = (broker: string, code?: string) => this.request<{ broker: string; source: string; obtained_at: string }>('POST', `/brokers/${broker}/login`, code ? { code } : {})
  funds = () => this.request<Funds>('GET', '/account/funds')
  products = () => this.request<Record<string, ProductChoice[]>>('GET', '/account/products')
  quote = (symbol: string) => this.request<BrokerQuote>('GET', `/quote${this.qs({ symbol })}`)
  /** What an order would cost (margin, value, funds left). Calculates only: nothing is sent to the exchange. */
  orderPreview = (req: OrderPreviewRequest) => this.request<OrderPreview>('POST', '/order-preview', req)
  searchSymbols = async (q: string) => (await this.request<{ results: SymbolHit[] }>('GET', `/symbols/search${this.qs({ q })}`)).results
  candles = (symbol: string, timeframe: Timeframe, limit = 500) =>
    this.request<{ symbol: string; timeframe: Timeframe; forming: boolean; candles: Candle[] }>('GET', `/candles${this.qs({ symbol, timeframe, limit })}`)

  watchlists = async () => (await this.request<{ watchlists: Watchlist[] }>('GET', '/watchlists')).watchlists
  createWatchlist = (name: string, symbols: string[] = []) => this.request<Watchlist>('POST', '/watchlists', { name, symbols })
  renameWatchlist = (id: string, name: string) => this.request<Watchlist>('PATCH', `/watchlists/${id}`, { name })
  deleteWatchlist = (id: string) => this.request<void>('DELETE', `/watchlists/${id}`)
  addToWatchlist = (id: string, symbols: string[]) => this.request<{ added: string[]; watchlist: Watchlist }>('POST', `/watchlists/${id}/symbols`, { symbols })
  removeFromWatchlist = (id: string, symbol: string) => this.request<Watchlist>('DELETE', `/watchlists/${id}/symbols/${encodeURIComponent(symbol)}`)
  reorderWatchlist = (id: string, symbols: string[]) => this.request<Watchlist>('PUT', `/watchlists/${id}/order`, { symbols })

  drawings = async (symbol: string) => (await this.request<{ drawings: Drawing[] }>('GET', `/drawings${this.qs({ symbol })}`)).drawings
  allDrawings = async () => (await this.request<{ drawings: Drawing[] }>('GET', '/drawings')).drawings
  createDrawing = (d: NewDrawing) => this.request<Drawing>('POST', '/drawings', d)
  updateDrawing = (id: string, patch: Partial<Pick<Drawing, 'points' | 'style' | 'label'>>) => this.request<Drawing>('PUT', `/drawings/${id}`, patch)
  deleteDrawing = (id: string) => this.request<void>('DELETE', `/drawings/${id}`)

  rules = async () => (await this.request<{ rules: Rule[] }>('GET', '/rules')).rules
  saveRule = (d: RuleDraft) => (d.id ? this.request<Rule>('PUT', `/rules/${d.id}`, draftToPayload(d)) : this.request<Rule>('POST', '/rules', draftToPayload(d)))
  setRuleEnabled = (id: string, enabled: boolean) => this.request<Rule>('PATCH', `/rules/${id}/enabled`, { enabled })
  deleteRule = (id: string) => this.request<void>('DELETE', `/rules/${id}`)
  signals = async (limit = 100) => (await this.request<{ signals: Signal[] }>('GET', `/signals${this.qs({ limit })}`)).signals

  positions = (history = 50) => this.request<{ open: Position[]; closed: Position[] }>('GET', `/positions${this.qs({ history })}`)
  closePosition = (id: string) => this.request<Position>('POST', `/positions/${id}/close`)

  financials = (symbol: string) => this.request<Financials>('GET', `/financials${this.qs({ symbol })}`)
  recentResults = async (days = 7) => (await this.request<{ results: RecentResult[] }>('GET', `/results/recent${this.qs({ days })}`)).results

  startBacktest = async (body: BacktestRequest) => (await this.request<{ id: string }>('POST', '/backtests', body)).id
  backtests = async () => (await this.request<{ backtests: BacktestRow[] }>('GET', '/backtests')).backtests
  backtest = (id: string) => this.request<BacktestFull>('GET', `/backtests/${id}`)
  deleteBacktest = (id: string) => this.request<void>('DELETE', `/backtests/${id}`)

  dataStatus = () => this.request<DataOverview>('GET', '/data/status')
  runDataJob = (body: { job: string } & Record<string, string | number>) => this.request<{ job_id?: string; status?: string }>('POST', '/data/run', body)

  sectors = async () => (await this.request<{ groups: SectorGroup[] }>('GET', '/sectors')).groups
  compareSector = (p: { group?: string; sector?: string; limit?: number }) => this.request<SectorCompare>('GET', `/sectors/compare${this.qs(p)}`)

  presets = async () => (await this.request<{ presets: Preset[] }>('GET', '/screener/presets')).presets
  columns = () => this.request<{ columns: ScreenColumn[]; operators: string[] }>('GET', '/screener/columns')
  runPreset = (name: string, limit = 200) => this.request<ScreenResult>('GET', `/screener/preset/${name}${this.qs({ limit })}`)
  runScreen = (filters: ScreenFilter[], sort: string, descending: boolean, limit = 200) =>
    this.request<ScreenResult>('POST', '/screener/run', { filters, sort, descending, limit })
  runScan = () => this.request<{ run_date: string | null; scanned: number; stored: number; skipped: number }>('POST', '/screener/scan')

  // strategy-screener -> watchlist
  syncStrategies = async () => (await this.request<{ strategies: SyncStrategy[] }>('GET', '/screener-sync/strategies')).strategies
  syncLinks = async () => (await this.request<{ links: SyncLink[] }>('GET', '/screener-sync/links')).links
  syncPreview = (s: SyncSettings) => this.request<SyncPlan>('POST', '/screener-sync/preview', s)
  syncApply = (s: SyncSettings) => this.request<SyncResult>('POST', '/screener-sync/apply', s)
  syncRefresh = async () => (await this.request<{ results: { strategy_id: number; ok: boolean; error?: string; added?: number; removed?: number }[] }>('POST', '/screener-sync/refresh')).results
  syncUnlink = (watchlistId: string) => this.request<void>('DELETE', `/screener-sync/links/${watchlistId}`)
}
