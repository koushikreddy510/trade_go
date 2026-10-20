import type { Tool } from '../store/state'
import { useApp, useSel } from './context'

const TOOLS: { tool: Tool; label: string; glyph: string; hint: string }[] = [
  { tool: 'cursor', label: 'Cursor', glyph: '↖', hint: 'Select and drag drawings (Esc)' },
  { tool: 'trend_line', label: 'Trend line', glyph: '╱', hint: 'Click two points' },
  { tool: 'ray', label: 'Ray', glyph: '➚', hint: 'Click two points; extends to the right' },
  { tool: 'horizontal_line', label: 'Level', glyph: '―', hint: 'Click once for a horizontal level' },
  { tool: 'rectangle', label: 'Zone', glyph: '▭', hint: 'Click two corners; rules can use its top or bottom edge as support/resistance' },
  { tool: 'text', label: 'Text', glyph: 'T', hint: 'Click to drop a note; name it in the Drawings tab' },
]

/** The vertical tool strip at the chart's left edge. */
export function DrawingRail() {
  const { ctl } = useApp()
  const tool = useSel((s) => s.tool)
  return (
    <div className="rail" role="group" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button key={t.tool} className={tool === t.tool ? 'rail-btn active' : 'rail-btn'} aria-pressed={tool === t.tool} aria-label={t.label} title={`${t.label}: ${t.hint}`} onClick={() => ctl.setTool(t.tool)}>
          <span aria-hidden="true">{t.glyph}</span>
        </button>
      ))}
    </div>
  )
}
