import { useState } from 'react'
import { fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { SymbolSearch } from './SymbolSearch'
import { useApp, useSel } from './context'

export function WatchlistPanel() {
  const { ctl } = useApp()
  const lists = useSel((s) => s.watchlists)
  const activeId = useSel((s) => s.activeWatchlistId)
  const quotes = useSel((s) => s.quotes)
  const current = useSel((s) => s.symbol)
  const [dragging, setDragging] = useState<string | null>(null)
  const active = lists.find((w) => w.id === activeId) ?? lists[0]

  const newList = () => {
    const name = window.prompt('Name of the new watchlist')
    if (name?.trim()) void ctl.createWatchlist(name.trim())
  }
  const rename = () => {
    if (!active) return
    const name = window.prompt('Rename watchlist', active.name)
    if (name?.trim()) void ctl.renameWatchlist(active.id, name.trim())
  }
  const remove = () => {
    if (active && window.confirm(`Delete the watchlist “${active.name}”?`)) void ctl.deleteWatchlist(active.id)
  }
  const dropOn = (target: string) => {
    if (!active || !dragging || dragging === target) return
    const symbols = active.symbols.filter((s) => s !== dragging)
    symbols.splice(symbols.indexOf(target), 0, dragging)
    void ctl.reorderWatchlist(symbols)
    setDragging(null)
  }

  return (
    <aside className="watchlist" aria-label="Watchlists">
      <div className="wl-tabs" role="tablist">
        {lists.map((w) => (
          <button key={w.id} role="tab" aria-selected={w.id === active?.id} className={w.id === active?.id ? 'tab active' : 'tab'} onClick={() => ctl.setActiveWatchlist(w.id)}>{w.name}</button>
        ))}
        <button className="tab add" title="New watchlist" aria-label="New watchlist" onClick={newList}>+</button>
      </div>
      <SymbolSearch placeholder="Add symbol…" onPick={(symbol) => void ctl.addToWatchlist(symbol)} />
      <ul className="wl-rows">
        {active?.symbols.map((symbol) => {
          const q = quotes[symbol]
          return (
            <li
              key={symbol}
              className={symbol === current ? 'row selected' : 'row'}
              draggable
              onDragStart={() => setDragging(symbol)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(symbol)}
              onClick={() => void ctl.selectSymbol(symbol)}
            >
              <span className="sym">{shortSymbol(symbol)}</span>
              <span className={`px ${sign(q?.change)}`}>{q ? fmtPrice(q.price) : '—'}</span>
              <span className={`chg ${sign(q?.change)}`}>{q ? fmtPct(q.change_pct) : ''}</span>
              <button className="x" aria-label={`Remove ${shortSymbol(symbol)}`} onClick={(e) => { e.stopPropagation(); void ctl.removeFromWatchlist(symbol) }}>×</button>
            </li>
          )
        })}
        {active && active.symbols.length === 0 && <li className="empty">Empty. Search above, or add from the Screener.</li>}
        {!active && <li className="empty">No watchlist yet.</li>}
      </ul>
      {active && (
        <div className="wl-actions">
          <button onClick={rename}>Rename</button>
          <button onClick={remove} disabled={lists.length <= 1}>Delete</button>
        </div>
      )}
    </aside>
  )
}
