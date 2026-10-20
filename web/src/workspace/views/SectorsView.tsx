import { useEffect, useMemo, useState } from 'react'
import type { SectorColumn, SectorCompare, SectorGroup, SectorRow } from '../api/types'
import { fmtCrore, fmtPct, shortSymbol, sign } from '../lib/format'
import { useApp } from '../components/context'

/** How each column's number is written. Anything not listed is a percentage. */
const PLAIN: Record<string, (n: number) => string> = {
  market_cap_cr: (n) => fmtCrore(n),
  pe_ratio: (n) => n.toFixed(1), pb_ratio: (n) => n.toFixed(1), rsi_14: (n) => n.toFixed(0),
}
const SIGNED = new Set(['revenue_growth_pct', 'profit_growth_pct', 'change_pct', 'ret_20d', 'ret_60d', 'ret_120d', 'pct_from_52w_high'])

const UNSIGNED_PCT = new Set(['roe_pct', 'roce_pct', 'dividend_yield'])

const show = (key: string, v: number | null) => {
  if (v === null) return '—'
  if (PLAIN[key]) return PLAIN[key](v)
  return UNSIGNED_PCT.has(key) ? `${v.toFixed(1)}%` : fmtPct(v, 1)
}

/** The best-in-group third is green, the worst third red; the middle stays neutral. */
function tone(rank: number | undefined, of: number): string {
  if (!rank || of < 3) return ''
  return rank <= Math.ceil(of / 3) ? 'up' : rank > of - Math.ceil(of / 3) ? 'down' : ''
}

/** Sectors and themes: pick a group, see every member side by side with where it ranks among its peers. */
export function SectorsView() {
  const { api, ctl } = useApp()
  const [groups, setGroups] = useState<SectorGroup[] | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [sector, setSector] = useState<string | null>(null)
  const [data, setData] = useState<SectorCompare | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  useEffect(() => {
    let live = true
    api.sectors().then((g) => { if (live) { setGroups(g); setGroup((cur) => cur ?? g[0]?.name ?? null) } }, (e) => { if (live) fail(e) })
    return () => { live = false }
  }, [api])

  useEffect(() => {
    if (!group) return
    let live = true
    setData(null)
    setError(null)
    setSortKey(null)
    api.compareSector(sector ? { sector } : { group }).then((d) => { if (live) setData(d) }, (e) => { if (live) fail(e) })
    return () => { live = false }
  }, [api, group, sector])

  const current = groups?.find((g) => g.name === group)
  const columns = data?.columns ?? []
  const rows = useMemo(() => {
    if (!data || !sortKey) return data?.rows ?? []
    const col = data.columns.find((c) => c.key === sortKey)
    const dir = col?.higher_is_better === false ? 1 : -1 // best first
    return [...data.rows].sort((a, b) => {
      const x = a.metrics[sortKey]
      const y = b.metrics[sortKey]
      return x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : dir * (x - y)
    })
  }, [data, sortKey])

  const makeWatchlist = async () => {
    if (!data) return
    const wl = await ctl.createWatchlist(sector ?? data.group, data.symbols)
    if (wl) ctl.openWatchlist(wl.id)
  }

  return (
    <div className="view sectors">
      {error && <p className="error" role="alert">{error}</p>}
      {groups === null && !error && <p className="muted">Loading…</p>}
      {groups !== null && groups.length === 0 && <p className="empty">No sector data yet. The data-store’s sector enrichment fills the sector of each symbol.</p>}
      {groups !== null && groups.length > 0 && (
        <div className="sector-layout">
          <ul className="sector-list" aria-label="Sector groups">
            {groups.map((g) => (
              <li key={g.name}>
                <button className={g.name === group ? 'sector-btn active' : 'sector-btn'} aria-pressed={g.name === group} onClick={() => { setGroup(g.name); setSector(null) }}>
                  {g.name}<span className="count">{g.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="sector-main">
            <div className="screener-top">
              <b>{sector ?? group}</b>
              {data && <span className="muted">{data.count} companies{data.rows.length < data.count ? `, showing the ${data.rows.length} largest` : ''}</span>}
              <button className="small" disabled={!data} onClick={() => void makeWatchlist()}>Make watchlist</button>
            </div>
            {current && current.sectors.length > 1 && (
              <div className="presets" role="group" aria-label="Industry">
                <button className={sector === null ? 'chip active' : 'chip'} onClick={() => setSector(null)}>All</button>
                {current.sectors.map((s) => <button key={s.name} className={sector === s.name ? 'chip active' : 'chip'} onClick={() => setSector(s.name)}>{s.name} <small>{s.count}</small></button>)}
              </div>
            )}
            {data === null && !error && <p className="muted">Loading…</p>}
            {data && (
              <div className="table-wrap">
                <table className="grid compare">
                  <thead>
                    <tr>
                      <th>Company</th>
                      {columns.map((c) => <HeaderCell key={c.key} col={c} active={sortKey === c.key} onSort={() => setSortKey(sortKey === c.key ? null : c.key)} />)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => <Row key={r.symbol} row={r} columns={columns} ranked={data.ranked} onOpen={() => { void ctl.selectSymbol(r.symbol); ctl.setView('chart') }} />)}
                    <tr className="median">
                      <th scope="row">Group median</th>
                      {columns.map((c) => <td key={c.key}>{show(c.key, data.medians[c.key] ?? null)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted note">Rank among {data?.count ?? '…'} peers: 1 is best (lowest P/E and P/B, highest returns, ROE and growth). Loss-makers’ negative P/E is left unranked. Click a column to sort.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function HeaderCell({ col, active, onSort }: { col: SectorColumn; active: boolean; onSort: () => void }) {
  return (
    <th className="sortable" aria-sort={active ? 'descending' : 'none'} onClick={onSort} title={col.label}>
      {col.label}{active ? ' ▾' : ''}
    </th>
  )
}

function Row({ row, columns, ranked, onOpen }: { row: SectorRow; columns: SectorColumn[]; ranked: Record<string, number>; onOpen: () => void }) {
  return (
    <tr>
      <td><button className="link" onClick={onOpen}>{shortSymbol(row.symbol)}</button> <span className="muted">{row.name}</span></td>
      {columns.map((c) => {
        const v = row.metrics[c.key] ?? null
        const rank = row.ranks[c.key]
        return (
          <td key={c.key} className={SIGNED.has(c.key) ? sign(v) : ''}>
            {show(c.key, v)}
            {rank !== undefined && <small className={`rank ${tone(rank, ranked[c.key])}`} title={`Rank ${rank} of ${ranked[c.key]}`}> #{rank}</small>}
          </td>
        )
      })}
    </tr>
  )
}
