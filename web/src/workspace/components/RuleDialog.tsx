import { useState } from 'react'
import { TIMEFRAMES, type Condition, type Drawing, type Edge, type EntryLevel, type IndicatorName, type Operand, type RuleDraft, type StopSpec, type TargetSpec, type Timeframe, type TrailSpec } from '../api/types'
import { INDICATORS } from '../lib/indicators'
import { defaultOperand, defaultTrail, edgeFor, levels, describeCondition, describeStop, describeTarget, describeTrail, validateDraft } from '../lib/rules'
import { shortSymbol } from '../lib/format'
import { useApp, useSel } from './context'

const OPERAND_KINDS: { kind: Operand['kind']; label: string }[] = [
  { kind: 'close', label: 'Close' }, { kind: 'open', label: 'Open' }, { kind: 'high', label: 'High' }, { kind: 'low', label: 'Low' }, { kind: 'volume', label: 'Volume' },
  { kind: 'indicator', label: 'Indicator' }, { kind: 'line', label: 'Drawn line' }, { kind: 'value', label: 'Fixed level' },
  { kind: 'highest', label: 'Highest of last N candles' }, { kind: 'lowest', label: 'Lowest of last N candles' },
]

/** Choose the line or zone a rule reads. A zone is two flat levels, so it also asks which edge. */
function LinePicker({ aria, drawings, value, onChange }: { aria: string; drawings: Drawing[]; value: { drawing_id: string; edge?: Edge }; onChange: (next: { drawing_id: string; edge?: Edge }) => void }) {
  const usable = levels(drawings)
  const chosen = usable.find((d) => d.id === value.drawing_id)
  return (
    <>
      <select aria-label={aria} value={value.drawing_id} onChange={(e) => onChange({ drawing_id: e.target.value, ...edgeFor(usable.find((d) => d.id === e.target.value)) })}>
        {usable.length === 0 && <option value="">(no lines on this chart)</option>}
        {usable.map((d) => <option key={d.id} value={d.id}>{d.label || (d.kind === 'rectangle' ? 'zone' : d.kind.replace('_', ' '))} ({d.points.map((p) => Math.round(p.price)).join('→')})</option>)}
      </select>
      {chosen?.kind === 'rectangle' && (
        <select aria-label={`${aria} edge`} value={value.edge ?? ''} onChange={(e) => onChange({ drawing_id: value.drawing_id, edge: e.target.value as Edge })}>
          <option value="top">top edge</option><option value="bottom">bottom edge</option>
        </select>
      )}
    </>
  )
}

type IndicatorValue = { name: IndicatorName; params: Record<string, number>; output: string }

function IndicatorFields<T extends IndicatorValue>({ value, onChange, label }: { value: T; onChange: (v: T) => void; label: string }) {
  const spec = INDICATORS[value.name]
  return (
    <>
      <select
        aria-label={`${label} indicator`}
        value={value.name}
        onChange={(e) => {
          const name = e.target.value as IndicatorName
          onChange({ ...value, name, params: { ...INDICATORS[name].defaults }, output: INDICATORS[name].outputs[0] })
        }}
      >
        {(Object.keys(INDICATORS) as IndicatorName[]).map((n) => <option key={n} value={n}>{INDICATORS[n].label}</option>)}
      </select>
      {Object.keys(spec.defaults).map((p) => (
        <label key={p} className="param">{p}
          <input aria-label={`${label} ${p}`} type="number" step="any" value={value.params[p] ?? spec.defaults[p]} onChange={(e) => onChange({ ...value, params: { ...value.params, [p]: Number(e.target.value) } })} />
        </label>
      ))}
      {spec.outputs.length > 1 && (
        <select aria-label={`${label} output`} value={value.output} onChange={(e) => onChange({ ...value, output: e.target.value })}>
          {spec.outputs.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </>
  )
}

function OperandEditor({ op, onChange, drawings, label }: { op: Operand; onChange: (o: Operand) => void; drawings: Drawing[]; label: string }) {
  return (
    <span className="operand">
      <select aria-label={`${label} type`} value={op.kind} onChange={(e) => onChange(defaultOperand(e.target.value as Operand['kind'], drawings))}>
        {OPERAND_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      {op.kind === 'value' && (
        <input aria-label={`${label} level`} type="number" step="any" value={Number.isFinite(op.value) ? op.value : ''} onChange={(e) => onChange({ kind: 'value', value: e.target.value === '' ? NaN : Number(e.target.value) })} />
      )}
      {(op.kind === 'highest' || op.kind === 'lowest') && (
        <>
          <label className="param">candles
            <input aria-label={`${label} candles`} type="number" min={1} max={500} value={Number.isFinite(op.bars) ? op.bars : ''} onChange={(e) => onChange({ ...op, bars: e.target.value === '' ? NaN : Number(e.target.value) })} />
          </label>
          <select aria-label={`${label} source`} value={op.source} onChange={(e) => onChange({ ...op, source: e.target.value as typeof op.source })}>
            {['high', 'low', 'close', 'open', 'volume'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      )}
      {op.kind === 'line' && <LinePicker aria={`${label} line`} drawings={drawings} value={op} onChange={(v) => onChange({ kind: 'line', ...v })} />}
      {op.kind === 'indicator' && <IndicatorFields label={label} value={op} onChange={onChange} />}
    </span>
  )
}

function ConditionEditor({ cond, onChange, onRemove, drawings, path }: { cond: Condition; onChange: (c: Condition) => void; onRemove?: () => void; drawings: Drawing[]; path: string }) {
  const switchType = (type: string) => {
    if (type === 'all' || type === 'any') {
      onChange({ type, conditions: cond.type === 'all' || cond.type === 'any' ? cond.conditions : [cond] })
    } else if (type === 'time_between') {
      onChange({ type, start: '09:20', end: '15:00' })
    } else if (cond.type === 'cross' || cond.type === 'compare') {
      onChange(type === 'cross' ? { type: 'cross', direction: 'above', a: cond.a, b: cond.b } : { type: 'compare', op: '>', a: cond.a, b: cond.b })
    } else {
      onChange(type === 'cross'
        ? { type: 'cross', direction: 'above', a: { kind: 'close' }, b: defaultOperand('indicator') }
        : { type: 'compare', op: '>', a: { kind: 'close' }, b: defaultOperand('indicator') })
    }
  }
  const isGroup = cond.type === 'all' || cond.type === 'any'
  return (
    <div className={isGroup ? 'cond group' : 'cond'}>
      <div className="cond-row">
        <select aria-label={`${path} kind`} value={cond.type} onChange={(e) => switchType(e.target.value)}>
          <option value="cross">Crosses</option>
          <option value="compare">Compare</option>
          <option value="time_between">Time window</option>
          <option value="all">All of (AND)</option>
          <option value="any">Any of (OR)</option>
        </select>
        {cond.type === 'cross' && (
          <>
            <OperandEditor label={`${path} left`} op={cond.a} drawings={drawings} onChange={(a) => onChange({ ...cond, a })} />
            <select aria-label={`${path} direction`} value={cond.direction} onChange={(e) => onChange({ ...cond, direction: e.target.value as 'above' | 'below' })}>
              <option value="above">crosses above</option><option value="below">crosses below</option>
            </select>
            <OperandEditor label={`${path} right`} op={cond.b} drawings={drawings} onChange={(b) => onChange({ ...cond, b })} />
          </>
        )}
        {cond.type === 'time_between' && (
          <>
            <span className="muted">candle closes between</span>
            <input aria-label={`${path} from`} type="time" value={cond.start} onChange={(e) => onChange({ ...cond, start: e.target.value })} />
            <span className="muted">and</span>
            <input aria-label={`${path} to`} type="time" value={cond.end} onChange={(e) => onChange({ ...cond, end: e.target.value })} />
            <span className="muted">IST</span>
          </>
        )}
        {cond.type === 'compare' && (
          <>
            <OperandEditor label={`${path} left`} op={cond.a} drawings={drawings} onChange={(a) => onChange({ ...cond, a })} />
            <select aria-label={`${path} operator`} value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value as typeof cond.op })}>
              {['>', '>=', '<', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <OperandEditor label={`${path} right`} op={cond.b} drawings={drawings} onChange={(b) => onChange({ ...cond, b })} />
          </>
        )}
        {onRemove && <button className="x" aria-label={`Remove ${path}`} onClick={onRemove}>×</button>}
      </div>
      {(cond.type === 'all' || cond.type === 'any') && (
        <div className="children">
          {cond.conditions.map((c, i) => (
            <ConditionEditor
              key={i}
              path={`${path}.${i + 1}`}
              cond={c}
              drawings={drawings}
              onChange={(next) => onChange({ ...cond, conditions: cond.conditions.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => onChange({ ...cond, conditions: cond.conditions.filter((_, j) => j !== i) })}
            />
          ))}
          <button className="small" onClick={() => onChange({ ...cond, conditions: [...cond.conditions, { type: 'compare', op: '>', a: { kind: 'close' }, b: { kind: 'value', value: 0 } }] })}>+ condition</button>
        </div>
      )}
    </div>
  )
}

const num = (v: string) => (v === '' ? NaN : Number(v))

function TimeframeSelect({ label, value, onChange, blank }: { label: string; value: Timeframe | null | undefined; onChange: (t: Timeframe | null) => void; blank: string }) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as Timeframe))}>
      <option value="">{blank}</option>
      {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

function TrailEditor({ trail, onChange, drawings }: { trail: TrailSpec | null | undefined; onChange: (t: TrailSpec | null) => void; drawings: Drawing[] }) {
  const tf = (t: TrailSpec) => (
    <TimeframeSelect label="Trail timeframe" blank="rule timeframe" value={t.timeframe} onChange={(timeframe) => onChange({ ...t, timeframe: timeframe ?? undefined })} />
  )
  return (
    <span className="operand">
      <select aria-label="Trail type" value={trail?.type ?? 'none'} onChange={(e) => onChange(e.target.value === 'none' ? null : { ...defaultTrail(e.target.value as TrailSpec['type'], drawings), ...(trail?.timeframe ? { timeframe: trail.timeframe } : {}) })}>
        <option value="none">No trailing stop</option>
        <option value="candle">Previous candle low/high</option>
        <option value="atr">ATR multiple</option>
        <option value="pct">% from the close</option>
        <option value="indicator">An indicator</option>
        <option value="line">A drawn line</option>
      </select>
      {trail?.type === 'candle' && (
        <>
          <label className="param">candles<input aria-label="Trail candles" type="number" min={1} max={50} value={Number.isFinite(trail.bars) ? trail.bars : ''} onChange={(e) => onChange({ ...trail, bars: num(e.target.value) })} /></label>
          <label className="param">buffer %<input aria-label="Trail buffer percent" type="number" step="any" value={Number.isFinite(trail.buffer_pct) ? trail.buffer_pct : ''} onChange={(e) => onChange({ ...trail, buffer_pct: num(e.target.value) })} /></label>
        </>
      )}
      {trail?.type === 'atr' && (
        <>
          <label className="param">period<input aria-label="Trail ATR period" type="number" value={Number.isFinite(trail.period) ? trail.period : ''} onChange={(e) => onChange({ ...trail, period: num(e.target.value) })} /></label>
          <label className="param">×<input aria-label="Trail ATR multiple" type="number" step="any" value={Number.isFinite(trail.mult) ? trail.mult : ''} onChange={(e) => onChange({ ...trail, mult: num(e.target.value) })} /></label>
        </>
      )}
      {trail?.type === 'pct' && <input aria-label="Trail percent" type="number" step="any" value={Number.isFinite(trail.value) ? trail.value : ''} onChange={(e) => onChange({ ...trail, value: num(e.target.value) })} />}
      {trail?.type === 'indicator' && <IndicatorFields label="Trail" value={trail} onChange={(v) => onChange(v)} />}
      {trail?.type === 'line' && <LinePicker aria="Trail line" drawings={drawings} value={trail} onChange={(v) => onChange({ ...trail, ...v, edge: v.edge })} />}
      {trail && tf(trail)}
    </span>
  )
}

function StopEditor({ stop, onChange, drawings }: { stop: StopSpec; onChange: (s: StopSpec) => void; drawings: Drawing[] }) {
  const change = (type: StopSpec['type']) => {
    switch (type) {
      case 'fixed': return onChange({ type, price: 0 })
      case 'pct': return onChange({ type, value: 1 })
      case 'atr': return onChange({ type, period: 14, mult: 2 })
      case 'candle': return onChange({ type, buffer_pct: 0 })
      case 'line': { const d = levels(drawings)[0]; return onChange({ type, drawing_id: d?.id ?? '', ...edgeFor(d) }) }
    }
  }
  return (
    <span className="operand">
      <select aria-label="Stop type" value={stop.type} onChange={(e) => change(e.target.value as StopSpec['type'])}>
        <option value="candle">Signal candle low/high</option>
        <option value="atr">ATR multiple</option>
        <option value="pct">% from entry</option>
        <option value="fixed">Fixed price</option>
        <option value="line">A drawn line</option>
      </select>
      {stop.type === 'fixed' && <input aria-label="Stop price" type="number" step="any" value={Number.isFinite(stop.price) ? stop.price : ''} onChange={(e) => onChange({ ...stop, price: num(e.target.value) })} />}
      {stop.type === 'pct' && <input aria-label="Stop percent" type="number" step="any" value={Number.isFinite(stop.value) ? stop.value : ''} onChange={(e) => onChange({ ...stop, value: num(e.target.value) })} />}
      {stop.type === 'atr' && (
        <>
          <label className="param">period<input aria-label="Stop ATR period" type="number" value={stop.period} onChange={(e) => onChange({ ...stop, period: num(e.target.value) })} /></label>
          <label className="param">×<input aria-label="Stop ATR multiple" type="number" step="any" value={stop.mult} onChange={(e) => onChange({ ...stop, mult: num(e.target.value) })} /></label>
        </>
      )}
      {stop.type === 'candle' && <label className="param">buffer %<input aria-label="Stop buffer percent" type="number" step="any" value={stop.buffer_pct} onChange={(e) => onChange({ ...stop, buffer_pct: num(e.target.value) })} /></label>}
      {stop.type === 'line' && <LinePicker aria="Stop line" drawings={drawings} value={stop} onChange={(v) => onChange({ ...stop, ...v, edge: v.edge })} />}
    </span>
  )
}

function TargetEditor({ target, onChange }: { target: TargetSpec | null; onChange: (t: TargetSpec | null) => void }) {
  const type = target?.type ?? 'none'
  const change = (t: string) => {
    if (t === 'none') onChange(null)
    else if (t === 'rr') onChange({ type: 'rr', ratio: 2 })
    else if (t === 'pct') onChange({ type: 'pct', value: 2 })
    else onChange({ type: 'fixed', price: 0 })
  }
  return (
    <span className="operand">
      <select aria-label="Target type" value={type} onChange={(e) => change(e.target.value)}>
        <option value="rr">Reward : risk</option><option value="pct">% from entry</option><option value="fixed">Fixed price</option><option value="none">No target</option>
      </select>
      {target?.type === 'rr' && <input aria-label="Target ratio" type="number" step="any" value={target.ratio} onChange={(e) => onChange({ ...target, ratio: num(e.target.value) })} />}
      {target?.type === 'pct' && <input aria-label="Target percent" type="number" step="any" value={target.value} onChange={(e) => onChange({ ...target, value: num(e.target.value) })} />}
      {target?.type === 'fixed' && <input aria-label="Target price" type="number" step="any" value={target.price} onChange={(e) => onChange({ ...target, price: num(e.target.value) })} />}
    </span>
  )
}

function Form({ initial }: { initial: RuleDraft }) {
  const { ctl } = useApp()
  const drawings = useSel((s) => s.drawings)
  const [draft, setDraft] = useState<RuleDraft>(initial)
  const [saving, setSaving] = useState(false)
  const errors = validateDraft(draft, drawings)
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const save = async () => {
    setSaving(true)
    const ok = await ctl.saveRule(draft)
    if (!ok) setSaving(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) ctl.openRuleDialog(null) }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit rule' : 'New rule'}>
        <h2>{draft.id ? 'Edit entry rule' : 'New entry rule'} <small>{shortSymbol(draft.symbol)}</small></h2>
        <p className="muted">Checked once each time a candle <b>closes</b>. A forming candle never triggers an entry. Entries are paper trades.</p>

        <div className="form-row">
          <label>Name<input aria-label="Rule name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Breakout above resistance" /></label>
          <label>Timeframe
            <select aria-label="Rule timeframe" value={draft.timeframe} onChange={(e) => set({ timeframe: e.target.value as Timeframe })}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          <label>Side
            <select aria-label="Rule side" value={draft.side} onChange={(e) => set({ side: e.target.value as 'BUY' | 'SELL' })}><option value="BUY">Buy</option><option value="SELL">Sell short</option></select>
          </label>
          <label>Quantity<input aria-label="Rule quantity" type="number" min={1} step={1} value={Number.isFinite(draft.quantity) ? draft.quantity : ''} onChange={(e) => set({ quantity: num(e.target.value) })} /></label>
        </div>

        <h3>Enter when</h3>
        <ConditionEditor path="c" cond={draft.condition} drawings={drawings} onChange={(condition) => set({ condition })} />

        <h3>Risk</h3>
        <div className="form-row">
          <label>Stop-loss<StopEditor stop={draft.stop} drawings={drawings} onChange={(stop) => set({ stop })} /></label>
          <label>Target<TargetEditor target={draft.target} onChange={(target) => set({ target })} /></label>
        </div>

        <h3>Entry sizing</h3>
        <div className="form-row">
          <label className="check">
            <input type="checkbox" aria-label="Score entry size by indicator distance" checked={!!draft.entry_score_indicator}
              onChange={(e) => set(e.target.checked
                ? { entry_score_indicator: { name: 'ema', params: { period: 20 }, output: 'value' },
                    entry_levels: [{ qty: draft.quantity, max_dist_pct: 0.5 }, { qty: Math.ceil(draft.quantity * 0.67), max_dist_pct: 2 }, { qty: Math.ceil(draft.quantity * 0.33) }] }
                : { entry_score_indicator: null, entry_levels: null })} /> Scale entry size by distance from indicator
          </label>
        </div>
        {draft.entry_score_indicator && draft.entry_levels && <>
          <div className="form-row">
            <label>Score indicator<IndicatorFields label="Entry score" value={draft.entry_score_indicator} onChange={(v) => set({ entry_score_indicator: { name: v.name as IndicatorName, params: v.params, output: v.output ?? 'value' } })} /></label>
          </div>
          <div className="form-row" style={{ flexDirection: 'column', gap: '4px' }}>
            {draft.entry_levels.map((lvl, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ minWidth: '80px', fontSize: '13px', color: 'var(--muted)' }}>
                  {i === draft.entry_levels!.length - 1 ? 'Catch-all' : `Level ${i + 1}`}
                </span>
                <label className="param">qty
                  <input aria-label={`Entry level ${i + 1} quantity`} type="number" min={1} step={1}
                    value={Number.isFinite(lvl.qty) ? lvl.qty : ''}
                    onChange={(e) => { const ls = [...draft.entry_levels!]; ls[i] = { ...ls[i], qty: Math.round(num(e.target.value)) }; set({ entry_levels: ls }) }} />
                </label>
                {i < draft.entry_levels!.length - 1 && (
                  <label className="param">max dist %
                    <input aria-label={`Entry level ${i + 1} max distance`} type="number" min={0.01} step={0.1}
                      value={Number.isFinite(lvl.max_dist_pct) ? lvl.max_dist_pct : ''}
                      onChange={(e) => { const ls = [...draft.entry_levels!]; ls[i] = { ...ls[i], max_dist_pct: num(e.target.value) }; set({ entry_levels: ls }) }} />
                  </label>
                )}
                {draft.entry_levels!.length > 1 && (
                  <button style={{ fontSize: '11px', padding: '2px 6px' }}
                    onClick={() => { const ls = draft.entry_levels!.filter((_, j) => j !== i); set({ entry_levels: ls }) }}>✕</button>
                )}
              </div>
            ))}
            {draft.entry_levels.length < 3 && (
              <button style={{ alignSelf: 'flex-start', fontSize: '12px' }}
                onClick={() => {
                  const last = draft.entry_levels![draft.entry_levels!.length - 1]
                  const newLevel: EntryLevel = { qty: last.qty }
                  const updated = [...draft.entry_levels!.slice(0, -1), { ...last, max_dist_pct: last.max_dist_pct ?? 2 }, newLevel]
                  set({ entry_levels: updated })
                }}>+ Add level</button>
            )}
          </div>
        </>}

        <h3>After entry</h3>
        <p className="muted">Both are copied onto the position when it opens, so editing this rule later never changes a trade that is running. They are checked on completed candles only, and the entry candle is skipped.</p>
        <div className="form-row">
          <label>Trailing stop<TrailEditor trail={draft.trail} drawings={drawings} onChange={(trail) => set({ trail })} /></label>
        </div>
        <div className="form-row">
          <label className="check">
            <input type="checkbox" aria-label="Exit on a condition" checked={!!draft.exit_condition} onChange={(e) => set(e.target.checked
              ? { exit_condition: { type: 'cross', direction: draft.side === 'BUY' ? 'below' : 'above', a: { kind: 'close' }, b: defaultOperand('indicator') } }
              : { exit_condition: null, exit_timeframe: null })} /> Exit when a condition is met
          </label>
          {draft.exit_condition && <label>Checked on<TimeframeSelect label="Exit timeframe" blank="rule timeframe" value={draft.exit_timeframe} onChange={(exit_timeframe) => set({ exit_timeframe })} /></label>}
        </div>
        {draft.exit_condition && <ConditionEditor path="x" cond={draft.exit_condition} drawings={drawings} onChange={(exit_condition) => set({ exit_condition })} />}

        {draft.exit_condition && <>
          <div className="form-row">
            <label className="check">
              <input type="checkbox" aria-label="Second exit on a condition" checked={!!draft.exit_condition_2} onChange={(e) => set(e.target.checked
                ? { exit_condition_2: { type: 'cross', direction: draft.side === 'BUY' ? 'below' : 'above', a: { kind: 'close' }, b: defaultOperand('indicator') } }
                : { exit_condition_2: null, exit_timeframe_2: null })} /> Exit remaining 50% on a second condition
            </label>
            {draft.exit_condition_2 && <label>Checked on<TimeframeSelect label="Exit 2 timeframe" blank="rule timeframe" value={draft.exit_timeframe_2} onChange={(exit_timeframe_2) => set({ exit_timeframe_2 })} /></label>}
          </div>
          {draft.exit_condition_2 && <ConditionEditor path="x2" cond={draft.exit_condition_2} drawings={drawings} onChange={(exit_condition_2) => set({ exit_condition_2 })} />}
        </>}

        <div className="form-row">
          <label className="check"><input type="checkbox" checked={draft.once} onChange={(e) => set({ once: e.target.checked })} /> Fire once, then switch off</label>
          <label className="check"><input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled</label>
        </div>

        <p className="preview" data-testid="rule-preview">
          {draft.side === 'BUY' ? 'Buy' : 'Sell'} {draft.quantity} {shortSymbol(draft.symbol)} on the {draft.timeframe} chart when {describeCondition(draft.condition, drawings)}; {describeStop(draft.stop, drawings)}, {describeTarget(draft.target)}{draft.trail ? `; ${describeTrail(draft.trail, drawings)}` : ''}{draft.exit_condition ? `; exit 50% when ${describeCondition(draft.exit_condition, drawings)}${draft.exit_timeframe ? ` on ${draft.exit_timeframe}` : ''}` : ''}{draft.exit_condition_2 ? `; exit remaining 50% when ${describeCondition(draft.exit_condition_2, drawings)}${draft.exit_timeframe_2 ? ` on ${draft.exit_timeframe_2}` : ''}` : ''}.
        </p>
        {errors.length > 0 && <ul className="errors" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

        <div className="modal-actions">
          <button onClick={() => ctl.openRuleDialog(null)}>Cancel</button>
          <button className="primary" disabled={errors.length > 0 || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save rule'}</button>
        </div>
      </div>
    </div>
  )
}

export function RuleDialog() {
  const draft = useSel((s) => s.ruleDialog)
  if (!draft) return null
  return <Form key={draft.id ?? 'new'} initial={draft} />
}
