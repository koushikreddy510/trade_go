// The bottom dock: tabs plus the Rules, Signals and Drawings panels.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dock } from './Dock'
import { SBIN, T0, line, makeApp, position, renderIn, rule, signal } from './testharness'

afterEach(() => vi.restoreAllMocks())

describe('Dock tabs', () => {
  it('shows a count on each tab and switches panels', async () => {
    const app = makeApp({}, { positions: { open: [position()], closed: [] }, signals: [signal()], rules: [rule(), rule({ id: 'r2', enabled: false })], drawings: [line()] })
    renderIn(<Dock />, app)
    expect(screen.getByRole('tab', { name: /Positions/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Signals/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /Rules/ })).toHaveTextContent('1') // only enabled rules are counted
    expect(screen.getByRole('tab', { name: /Drawings/ })).toHaveTextContent('1')
    expect(screen.getByLabelText('Positions')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Financials/ }))
    expect(app.store.get().dock).toBe('financials')
    expect(screen.getByLabelText('Financials')).toBeInTheDocument()
  })
})

describe('Rules panel', () => {
  const rules = (over = {}) => makeApp({}, { dock: 'rules', rules: [rule(), ...Object.values(over)] as never, drawings: [line()] })

  it('explains each rule in plain English', () => {
    renderIn(<Dock />, rules())
    expect(screen.getByText('Breakout')).toBeInTheDocument()
    expect(screen.getByText('When Close crosses above a line.')).toBeInTheDocument()
    expect(screen.getByText('stop at signal candle low/high, target 2R.')).toBeInTheDocument()
    expect(screen.getByText(/SBIN · 1H · BUY 5/)).toBeInTheDocument()
  })

  it('invites the user to make a rule when there are none', () => {
    renderIn(<Dock />, makeApp({}, { dock: 'rules' }))
    expect(screen.getByText(/No rules\./)).toBeInTheDocument()
  })

  it('starts a new rule for the symbol and timeframe on screen', async () => {
    const app = makeApp({}, { dock: 'rules', timeframe: '15m' })
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('button', { name: /New rule for SBIN/ }))
    expect(app.store.get().ruleDialog).toMatchObject({ symbol: SBIN, timeframe: '15m' })
  })

  it('switches a rule off and on', async () => {
    const app = rules()
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(app.api.setRuleEnabled).toHaveBeenCalledWith('r1', false))
  })

  it('opens a rule for editing', async () => {
    const app = rules()
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(app.store.get().ruleDialog?.id).toBe('r1')
  })

  it('deletes a rule only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const app = rules()
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(app.api.deleteRule).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(app.api.deleteRule).toHaveBeenCalledWith('r1'))
    expect(confirm).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByText('Breakout')).not.toBeInTheDocument())
  })
})

describe('Signals panel', () => {
  it('lists when each candle closed, what was entered, and skipped signals with the reason', () => {
    const entered = signal()
    const skipped = signal({ id: 's2', status: 'rejected', reason: 'already in a position', bar_time: T0 + 3600 })
    renderIn(<Dock />, makeApp({}, { dock: 'signals', signals: [skipped, entered], rules: [rule()] }))
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText(/Skipped: already in a position/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('Entered')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Breakout')).toBeInTheDocument()
    expect(within(rows[1]).getByText('101.00')).toBeInTheDocument()
    // the signal bar opened at T0 (09:15 IST) and a 1H bar closes at 10:15
    expect(within(rows[1]).getByText(/10:15/)).toBeInTheDocument()
  })

  it('explains an empty list', () => {
    renderIn(<Dock />, makeApp({}, { dock: 'signals' }))
    expect(screen.getByText(/No signals yet/)).toBeInTheDocument()
  })
})

describe('Drawings panel', () => {
  it('lists the lines on this chart and selects one', async () => {
    const app = makeApp({}, { dock: 'drawings', drawings: [line(), line({ id: 'd2', kind: 'horizontal_line', points: [{ time: T0, price: 98 }] })] })
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByText('Level'))
    expect(app.store.get().selectedDrawingId).toBe('d2')
  })

  it('explains how to draw when empty', () => {
    renderIn(<Dock />, makeApp({}, { dock: 'drawings' }))
    expect(screen.getByText(/click two points/)).toBeInTheDocument()
  })

  it('saves a label when the user leaves the box', async () => {
    const app = makeApp({}, { dock: 'drawings', drawings: [line()] })
    renderIn(<Dock />, app)
    await userEvent.type(screen.getByLabelText('Line label'), 'Resistance')
    await userEvent.tab()
    await waitFor(() => expect(app.api.updateDrawing).toHaveBeenCalledWith('d1', { label: 'Resistance' }))
  })

  it('one click turns a line into an entry rule (above = buy, below = sell)', async () => {
    const app = makeApp({}, { dock: 'drawings', drawings: [line({ label: 'Trend' })] })
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Enter when close crosses below' }))
    expect(app.store.get().ruleDialog).toMatchObject({ side: 'SELL', condition: { type: 'cross', direction: 'below', b: { kind: 'line', drawing_id: 'd1' } } })
    await userEvent.click(screen.getByRole('button', { name: 'Enter when close crosses above' }))
    expect(app.store.get().ruleDialog).toMatchObject({ side: 'BUY', condition: { direction: 'above' } })
  })

  it('deletes a line', async () => {
    const app = makeApp({}, { dock: 'drawings', drawings: [line()] })
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(app.api.deleteDrawing).toHaveBeenCalledWith('d1'))
  })

  it('shows the server’s reason when a line is still used by a rule', async () => {
    const app = makeApp({ deleteDrawing: async () => { throw new Error('line is used by rule “Breakout”') } }, { dock: 'drawings', drawings: [line()] })
    renderIn(<Dock />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(app.store.get().toast?.text).toBe('line is used by rule “Breakout”'))
    expect(app.store.get().drawings).toHaveLength(1)
  })
})
