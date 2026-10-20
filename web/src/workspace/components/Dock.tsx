import type { DockTab } from '../store/state'
import { useApp, useSel } from './context'
import { DrawingsPanel } from './DrawingsPanel'
import { FinancialsPanel } from './FinancialsPanel'
import { PositionsPanel } from './PositionsPanel'
import { RulesPanel } from './RulesPanel'
import { SignalsPanel } from './SignalsPanel'
import { TriggersPanel } from './TriggersPanel'

export function Dock() {
  const { ctl } = useApp()
  const dock = useSel((s) => s.dock)
  const collapsed = useSel((s) => s.dockCollapsed)
  const open = useSel((s) => s.positions.open.length)
  const signals = useSel((s) => s.signals.length)
  const rules = useSel((s) => s.rules.filter((r) => r.enabled).length)
  const drawings = useSel((s) => s.drawings.length)
  const tabs: { id: DockTab; label: string; count?: number }[] = [
    { id: 'positions', label: 'Positions', count: open },
    { id: 'signals', label: 'Signals', count: signals },
    { id: 'rules', label: 'Rules', count: rules },
    { id: 'financials', label: 'Financials' },
    { id: 'triggers', label: 'Triggers' },
    { id: 'drawings', label: 'Drawings', count: drawings },
  ]
  return (
    <section className={`dock${collapsed ? ' dock-collapsed' : ''}`} aria-label="Details">
      <div className="dock-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={dock === t.id} className={dock === t.id ? 'tab active' : 'tab'} onClick={() => { if (collapsed) ctl.toggleDockCollapsed(); ctl.setDock(t.id) }}>
            {t.label}{t.count ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
        <button className="dock-collapse-btn" title={collapsed ? 'Expand panel' : 'Collapse panel'} onClick={() => ctl.toggleDockCollapsed()}>
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && (
        <div className="dock-body">
          {dock === 'positions' && <PositionsPanel />}
          {dock === 'signals' && <SignalsPanel />}
          {dock === 'rules' && <RulesPanel />}
          {dock === 'financials' && <FinancialsPanel />}
          {dock === 'triggers' && <TriggersPanel />}
          {dock === 'drawings' && <DrawingsPanel />}
        </div>
      )}
    </section>
  )
}
