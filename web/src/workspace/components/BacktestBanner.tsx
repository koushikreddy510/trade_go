import { fmtPnl, shortSymbol } from '../lib/format'
import { useApp, useSel } from './context'

/** Shown over the chart while a backtest's trades are drawn on it: what is shown, and a way to step through the trades. */
export function BacktestBanner() {
  const { ctl } = useApp()
  const bt = useSel((s) => s.btOverlay)
  const symbol = useSel((s) => s.symbol)
  if (!bt) return null
  const mine = bt.trades.filter((t) => t.symbol === symbol)
  const open = bt.open.filter((o) => o.symbol === symbol).length
  const pnl = mine.reduce((sum, t) => sum + t.pnl, 0)
  const at = mine.findIndex((t) => Date.parse(t.entry_time) / 1000 === bt.focus)
  const go = (i: number) => ctl.focusBacktest(mine[(i + mine.length) % mine.length].entry_time)
  return (
    <div className="bt-banner" role="status" aria-label="Backtest on chart">
      <span>Backtest {bt.label}</span>
      <b>{shortSymbol(symbol)}</b>
      <span>{mine.length} trade{mine.length === 1 ? '' : 's'}{open > 0 ? ` + ${open} open` : ''}</span>
      {mine.length > 0 && <b className={pnl >= 0 ? 'up' : 'down'}>{fmtPnl(pnl)}</b>}
      {mine.length > 0 && (
        <span className="bt-step">
          <button className="small" aria-label="Previous trade" onClick={() => go(at <= 0 ? -1 : at - 1)}>‹</button>
          <span>{at < 0 ? '–' : at + 1}/{mine.length}</span>
          <button className="small" aria-label="Next trade" onClick={() => go(at + 1)}>›</button>
        </span>
      )}
      <button className="small" onClick={() => ctl.hideBacktest()}>Hide</button>
    </div>
  )
}
