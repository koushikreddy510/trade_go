const dash = '—'

export function fmtPrice(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return dash
  return n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return dash
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`
}

/** Signed money, e.g. "+1,234.50" / "-90.00". */
export function fmtPnl(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return dash
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Large share counts: 1.2L (lakh), 3.4Cr (crore), as Indian markets quote them. */
export function fmtVolume(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return dash
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

/** screener.in reports money in Rs crore. */
export function fmtCrore(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return dash
  return n.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 })
}

export const sign = (n: number | null | undefined): 'up' | 'down' | 'flat' => (!n ? 'flat' : n > 0 ? 'up' : 'down')

/** 'NSE:SBIN-EQ' -> 'SBIN' */
export function shortSymbol(symbol: string): string {
  const base = symbol.includes(':') ? symbol.split(':')[1] : symbol
  if (base.endsWith('-INDEX')) return base.slice(0, -6)   // 'NSE:NIFTYIT-INDEX' -> 'NIFTYIT'
  return base.endsWith('-EQ') ? base.slice(0, -3) : base
}
