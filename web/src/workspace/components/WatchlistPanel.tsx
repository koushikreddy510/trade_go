import { useEffect, useState } from 'react'
import { fmtPct, fmtPrice, shortSymbol, sign } from '../lib/format'
import { SymbolSearch } from './SymbolSearch'
import { useApp, useSel } from './context'

export function WatchlistPanel({ collapsed, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const { ctl } = useApp()
  const lists = useSel((s) => s.watchlists)
  const activeId = useSel((s) => s.activeWatchlistId)
  const quotes = useSel((s) => s.quotes)
  const current = useSel((s) => s.symbol)
  const [dragging, setDragging] = useState<string | null>(null)
  const browse = useSel((s) => s.browse)
  const browsing = useSel((s) => s.browseActive)
  const active = lists.find((w) => w.id === activeId) ?? lists[0]
  const symbols = browsing && browse ? browse.symbols : active?.symbols ?? []

  // Up / Down walk the list (not while typing in a field)
  useEffect(() => {
    if (collapsed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      if (symbols.length === 0) return
      e.preventDefault()
      const at = symbols.indexOf(current)
      const next = e.key === 'ArrowDown' ? Math.min(at + 1, symbols.length - 1) : Math.max(at - 1, 0)
      if (symbols[next] !== current) void ctl.selectSymbol(symbols[next])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl, symbols, current, collapsed])

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
    if (!active || browsing || !dragging || dragging === target) return
    const symbols = active.symbols.filter((s) => s !== dragging)
    symbols.splice(symbols.indexOf(target), 0, dragging)
    void ctl.reorderWatchlist(symbols)
    setDragging(null)
  }

  if (collapsed) {
    return (
      <aside className="watchlist wl-collapsed" aria-label="Watchlists">
        <button className="wl-collapse-btn" title="Expand watchlist" onClick={onToggle}>▶</button>
      </aside>
    )
  }

  return (
    <aside className="watchlist" aria-label="Watchlists">
      <div className="wl-tabs" role="tablist">
        {browse && (
          <span className={browsing ? 'tab active' : 'tab'}>
            <button role="tab" aria-selected={browsing} title="Screener results you are browsing (not saved)" onClick={() => void ctl.openResults(browse, browse.symbols.includes(current) ? current : browse.symbols[0])}>{`Results: ${browse.label} · ${browse.timeframe} (${browse.symbols.length})`}</button>
            <button className="x" aria-label="Close results" onClick={() => ctl.closeResults()}>×</button>
          </span>
        )}
        {lists.map((w) => (
          <button key={w.id} role="tab" aria-selected={w.id === active?.id} title={w.name} className={w.id === active?.id ? 'tab active' : 'tab'} onClick={() => ctl.setActiveWatchlist(w.id)}>{w.name}</button>
        ))}
        <button className="tab add" title="New watchlist" aria-label="New watchlist" onClick={newList}>+</button>
        <button className="wl-collapse-btn" title="Collapse watchlist" onClick={onToggle}>◀</button>
      </div>
      <SymbolSearch placeholder="Add symbol…" onPick={(symbol) => void ctl.addToWatchlist(symbol)} />
      <ul className="wl-rows">
        {symbols.map((symbol) => {
          const q = quotes[symbol]
          return (
            <li
              key={symbol}
              className={symbol === current ? 'row selected' : 'row'}
              ref={symbol === current ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
              draggable
              onDragStart={() => setDragging(symbol)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(symbol)}
              onClick={() => void ctl.selectSymbol(symbol)}
            >
              <span className="sym">{shortSymbol(symbol)}</span>
              <span className={`px ${sign(q?.change)}`}>{q ? fmtPrice(q.price) : '—'}</span>
              <span className={`chg ${sign(q?.change)}`}>{q ? fmtPct(q.change_pct) : ''}</span>
              {!browsing && <button className="x" aria-label={`Remove ${shortSymbol(symbol)}`} onClick={(e) => { e.stopPropagation(); void ctl.removeFromWatchlist(symbol) }}>×</button>}
            </li>
          )
        })}
        {!browsing && active && active.symbols.length === 0 && <li className="empty">Empty. Search above, or add from the Screener.</li>}
        {!active && <li className="empty">No watchlist yet.</li>}
      </ul>
      {active && !browsing && (
        <div className="wl-actions">
          <button onClick={rename}>Rename</button>
          <button onClick={remove} disabled={lists.length <= 1}>Delete</button>
        </div>
      )}
    </aside>
  )
}
