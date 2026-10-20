import { useEffect, useRef, useState } from 'react'
import type { SymbolHit } from '../api/types'
import { useApp } from './context'

type Props = { placeholder?: string; onPick: (symbol: string) => void; clearOnPick?: boolean }

/** Type-ahead over the data-store's symbols table. */
export function SymbolSearch({ placeholder = 'Search symbol or company…', onPick, clearOnPick = true }: Props) {
  const { api } = useApp()
  const [text, setText] = useState('')
  const [hits, setHits] = useState<SymbolHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    const q = text.trim()
    if (!q) { setHits([]); return }
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchSymbols(q)
        if (mine === seq.current) { setHits(results); setActive(0) }
      } catch { if (mine === seq.current) setHits([]) }
    }, 180)
    return () => clearTimeout(timer)
  }, [text, api])

  const pick = (symbol: string) => {
    onPick(symbol)
    setOpen(false)
    if (clearOnPick) setText('')
  }

  // A typed "NSE:SBIN-EQ" (or "SBIN") can be taken as is when the symbols table has no match.
  const typed = text.trim().toUpperCase()
  const asSymbol = /^[A-Z]{2,5}:[A-Z0-9&_.-]+$/.test(typed) ? typed : null

  return (
    <div className="search">
      <input
        value={text}
        placeholder={placeholder}
        aria-label="Search symbols"
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { closeTimer.current = setTimeout(() => setOpen(false), 150) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { const h = hits[active]; if (h) pick(h.symbol); else if (asSymbol) pick(asSymbol) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && (hits.length > 0 || asSymbol) && (
        <ul className="search-results" role="listbox">
          {hits.map((h, i) => (
            <li key={h.symbol} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={() => pick(h.symbol)}>
              <b>{h.symbol.split(':')[1]}</b>
              <span>{h.name}</span>
              <em>{h.exchange}{h.sector ? ` · ${h.sector}` : ''}</em>
            </li>
          ))}
          {hits.length === 0 && asSymbol && <li role="option" onMouseDown={() => pick(asSymbol)}><b>{asSymbol}</b><span>Use this symbol</span></li>}
        </ul>
      )}
    </div>
  )
}
