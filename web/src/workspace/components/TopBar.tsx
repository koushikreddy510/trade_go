import { useApp, useSel } from './context'
import { ThemeMenu } from './ThemeMenu'
import type { View } from '../store/state'

const NAV: { view: View; label: string }[] = [
  { view: 'chart', label: 'Chart' },
  { view: 'screener', label: 'Screener' },
  { view: 'sectors', label: 'Sectors' },
  { view: 'backtests', label: 'Backtests' },
  { view: 'strategies', label: 'Strategies' },
  { view: 'results', label: 'Results' },
  { view: 'data', label: 'Data' },
]

export function TopBar() {
  const { ctl } = useApp()
  const view = useSel((s) => s.view)
  const connection = useSel((s) => s.connection)
  const feed = useSel((s) => s.feed)
  const server = useSel((s) => s.server)
  const live = connection === 'open' && feed === 'connected'
  const demo = server?.mode === 'demo'
  return (
    <header className="topbar">
      <div className="brand">Atlas<span>Workspace</span></div>
      <nav aria-label="Views">
        {NAV.map((n) => (
          <button key={n.view} className={view === n.view ? 'tab active' : 'tab'} onClick={() => ctl.setView(n.view)}>{n.label}</button>
        ))}
      </nav>
      <div className="spacer" />
      {demo && <span className="badge demo" title="Prices are generated, not from a broker. Set TERMINAL_MODE=flattrade for live prices.">DEMO DATA</span>}
      <span className={`status ${live ? 'ok' : 'down'}`} role="status">
        <i className="dot" />
        {connection !== 'open' ? `Server ${connection}` : feed === 'connected' ? 'Live' : `Feed ${feed}`}
      </span>
      <ThemeMenu />
      <a className="link muted" href="https://www.tradingview.com/" target="_blank" rel="noreferrer" title="Charts: TradingView Lightweight Charts">Charts by TradingView</a>
      <a className="link" href="?view=atlas" title="The original silver terminal">Atlas (MCX silver)</a>
    </header>
  )
}
