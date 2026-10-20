// Draws trend lines, rays and horizontal lines on the chart canvas.
//
// Lines are placed with the same maths the rule engine uses (bar-index space, see
// lib/lines.ts), so the line you see is the line a rule evaluates. Trend lines show a
// dashed continuation to the right edge: that is where a rule reads their value.
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer, Logical, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts'
import type { Drawing, DrawingKind, DrawingPoint, Timeframe } from '../api/types'
import { distanceToSegment } from '../lib/lines'
import { fmtPrice } from '../lib/format'
import { COLORS, drawingAnchors } from './overlays'

export type PreviewLine = { kind: DrawingKind; points: DrawingPoint[] }
export type Pixel = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }
type Geometry = { id: string; kind: DrawingKind; color: string; label: string; anchors: Pixel[]; segments: { from: Pixel; to: Pixel; dashed: boolean }[]; fill?: Box; textBox?: Box }

const HIT_DISTANCE = 6
const HANDLE_RADIUS = 5

/** '#rrggbb' + opacity -> 'rgba(...)'; anything that is not a 6-digit hex is returned untouched. */
export function hexAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})` : color
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<SeriesType> | null = null
  private requestUpdate: (() => void) | null = null
  private drawings: Drawing[] = []
  private times: number[] = []
  private tf: Timeframe = '1H'
  private selectedId: string | null = null
  private preview: PreviewLine | null = null
  private override: { id: string; points: DrawingPoint[] } | null = null
  private width = 0

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi
    this.series = param.series
    this.requestUpdate = param.requestUpdate
  }
  detached(): void {
    this.chart = null
    this.series = null
  }

  set(state: { drawings?: Drawing[]; times?: number[]; tf?: Timeframe; selectedId?: string | null; preview?: PreviewLine | null; override?: { id: string; points: DrawingPoint[] } | null }): void {
    if (state.drawings !== undefined) this.drawings = state.drawings
    if (state.times !== undefined) this.times = state.times
    if (state.tf !== undefined) this.tf = state.tf
    if (state.selectedId !== undefined) this.selectedId = state.selectedId
    if (state.preview !== undefined) this.preview = state.preview
    if (state.override !== undefined) this.override = state.override
    this.requestUpdate?.()
  }

  updateAllViews(): void {}

  private toPixel(index: number, price: number): Pixel | null {
    if (!this.chart || !this.series) return null
    const x = this.chart.timeScale().logicalToCoordinate(index as Logical)
    const y = this.series.priceToCoordinate(price)
    return x === null || y === null ? null : { x, y }
  }

  private geometry(): Geometry[] {
    const all: { id: string; d: Pick<Drawing, 'kind' | 'points' | 'style' | 'label'> }[] = this.drawings.map((d) => ({
      id: d.id,
      d: this.override && this.override.id === d.id ? { ...d, points: this.override.points } : d,
    }))
    if (this.preview) all.push({ id: '__preview__', d: { ...this.preview, style: {}, label: '' } })
    const out: Geometry[] = []
    for (const { id, d } of all) {
      const anchors = drawingAnchors({ ...d, id, symbol: '' } as Drawing, this.times, this.tf).map((a) => this.toPixel(a.index, a.price))
      if (anchors.some((a) => a === null) || anchors.length === 0) continue
      const px = anchors as Pixel[]
      const color = d.style?.color ?? COLORS.line
      const segments: Geometry['segments'] = []
      const W = this.width || 4000
      let fill: Box | undefined
      let textBox: Box | undefined
      if (d.kind === 'horizontal_line') {
        segments.push({ from: { x: 0, y: px[0].y }, to: { x: W, y: px[0].y }, dashed: false })
      } else if (d.kind === 'text') {
        textBox = { x: px[0].x, y: px[0].y - 16, w: 7 * Math.max(d.label.length, 1) + 12, h: 20 }
      } else if (d.kind === 'rectangle') {
        const left = Math.min(px[0].x, px[1].x), right = Math.max(px[0].x, px[1].x)
        const top = Math.min(px[0].y, px[1].y), bottom = Math.max(px[0].y, px[1].y)
        fill = { x: left, y: top, w: right - left, h: bottom - top }
        segments.push(
          { from: { x: left, y: top }, to: { x: right, y: top }, dashed: false }, { from: { x: left, y: bottom }, to: { x: right, y: bottom }, dashed: false },
          { from: { x: left, y: top }, to: { x: left, y: bottom }, dashed: false }, { from: { x: right, y: top }, to: { x: right, y: bottom }, dashed: false },
        )
        // a rule reads each edge as a flat level, so show where it carries on to the right
        if (right < W) segments.push({ from: { x: right, y: top }, to: { x: W, y: top }, dashed: true }, { from: { x: right, y: bottom }, to: { x: W, y: bottom }, dashed: true })
      } else if (px.length === 2) {
        const [a, b] = px[0].x <= px[1].x ? [px[0], px[1]] : [px[1], px[0]]
        const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x)
        const end = { x: W, y: b.y + slope * (W - b.x) }
        if (d.kind === 'ray') segments.push({ from: a, to: end, dashed: false })
        else {
          segments.push({ from: a, to: b, dashed: false })
          if (b.x < W && b.x !== a.x) segments.push({ from: b, to: end, dashed: true })
        }
      }
      out.push({ id, kind: d.kind, color, label: d.label, anchors: px, segments, fill, textBox })
    }
    return out
  }

  /** What is under the mouse: a handle of the selected line, or a line body. */
  pick(x: number, y: number): { id: string; handle: number | null } | null {
    const geo = this.geometry().filter((g) => g.id !== '__preview__')
    const selected = geo.find((g) => g.id === this.selectedId)
    if (selected) {
      const handle = selected.anchors.findIndex((a) => Math.hypot(a.x - x, a.y - y) <= HANDLE_RADIUS + 3)
      if (handle >= 0) return { id: selected.id, handle }
    }
    let best: { id: string; dist: number } | null = null
    for (const g of geo) {
      const b = g.textBox
      if (b && x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) return { id: g.id, handle: null }
      for (const s of g.segments) {
        const dist = distanceToSegment(x, y, s.from.x, s.from.y, s.to.x, s.to.y)
        if (dist <= HIT_DISTANCE && (!best || dist < best.dist)) best = { id: g.id, dist }
      }
    }
    return best ? { id: best.id, handle: null } : null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => 'top', renderer: () => this.renderer }]
  }

  private renderer: IPrimitivePaneRenderer = {
    draw: (target: CanvasRenderingTarget2D) => {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        this.width = mediaSize.width
        for (const g of this.geometry()) {
          const selected = g.id === this.selectedId
          const preview = g.id === '__preview__'
          ctx.save()
          if (g.fill) {
            ctx.fillStyle = preview ? 'rgba(232,232,232,.1)' : hexAlpha(g.color, selected ? 0.22 : 0.14)
            ctx.fillRect(g.fill.x, g.fill.y, g.fill.w, g.fill.h)
          }
          ctx.strokeStyle = preview ? 'rgba(247,185,85,.7)' : g.color
          ctx.lineWidth = selected ? 2.5 : 1.5
          for (const s of g.segments) {
            ctx.setLineDash(s.dashed || preview ? [6, 4] : [])
            ctx.globalAlpha = s.dashed ? 0.65 : 1
            ctx.beginPath()
            ctx.moveTo(s.from.x, s.from.y)
            ctx.lineTo(s.to.x, s.to.y)
            ctx.stroke()
          }
          ctx.setLineDash([])
          ctx.globalAlpha = 1
          if (selected) {
            for (const a of g.anchors) {
              ctx.fillStyle = '#000'
              ctx.strokeStyle = COLORS.selected
              ctx.lineWidth = 2
              ctx.beginPath()
              ctx.arc(a.x, a.y, HANDLE_RADIUS, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
            }
          }
          if (g.textBox && !preview) {
            const b = g.textBox
            ctx.fillStyle = 'rgba(0,0,0,.85)'
            ctx.fillRect(b.x, b.y, b.w, b.h)
            ctx.strokeStyle = selected ? COLORS.selected : g.color
            ctx.lineWidth = selected ? 2 : 1
            ctx.strokeRect(b.x, b.y, b.w, b.h)
            ctx.fillStyle = g.color
            ctx.font = '13px Inter, system-ui, sans-serif'
            ctx.fillText(g.label || 'Note', b.x + 6, b.y + 14)
            ctx.restore()
            continue
          }
          if (g.kind === 'rectangle' && g.fill && g.label && !preview) {
            ctx.fillStyle = g.color
            ctx.font = '11px Inter, system-ui, sans-serif'
            ctx.fillText(g.label, g.fill.x + 6, g.fill.y + 14)
            ctx.restore()
            continue
          }
          const tail = g.kind === 'horizontal_line' ? { x: 8, y: g.segments[0]?.from.y ?? 0 } : g.anchors[g.anchors.length - 1]
          if (g.label && !preview && tail) {
            ctx.fillStyle = g.color
            ctx.font = '11px Inter, system-ui, sans-serif'
            ctx.fillText(g.label, tail.x + 8, tail.y - 6)
          }
          ctx.restore()
        }
      })
    },
  }

  /** Price label for horizontal lines (used by the drawings list). */
  static describe(d: Drawing): string {
    if (d.kind === 'horizontal_line') return `Horizontal line at ${fmtPrice(d.points[0].price)}`
    if (d.kind === 'text') return `Note at ${fmtPrice(d.points[0].price)}`
    if (d.kind === 'rectangle') return `Zone ${fmtPrice(Math.min(...d.points.map((p) => p.price)))} – ${fmtPrice(Math.max(...d.points.map((p) => p.price)))}`
    return `${d.kind === 'ray' ? 'Ray' : 'Trend line'} ${fmtPrice(d.points[0].price)} → ${fmtPrice(d.points[1].price)}`
  }
}
