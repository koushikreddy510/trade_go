// Building an entry rule: the sentence it previews, the mistakes it catches, and exactly what gets saved.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { draftFromLine, newDraft } from '../lib/rules'
import { RuleDialog } from './RuleDialog'
import { SBIN, T0, line, makeApp, renderIn, rule } from './testharness'

const open = (app: ReturnType<typeof makeApp>, draft = newDraft(SBIN, '1H')) => {
  app.store.set({ ruleDialog: draft })
  return renderIn(<RuleDialog />, app)
}
const pick = (label: string, value: string) => userEvent.selectOptions(screen.getByLabelText(label), value)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const saved = (app: ReturnType<typeof makeApp>): any => app.api.saveRule.mock.calls[0][0]

describe('RuleDialog', () => {
  it('renders nothing while closed', () => {
    renderIn(<RuleDialog />, makeApp())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens with a sensible default and a plain-English preview', () => {
    open(makeApp())
    expect(screen.getByRole('dialog', { name: 'New rule' })).toBeInTheDocument()
    expect(screen.getByTestId('rule-preview')).toHaveTextContent('Buy 1 SBIN on the 1H chart when Close crosses above EMA 20; stop at signal candle low/high, target 2R.')
  })

  it('reminds the user that only completed candles trigger entries', () => {
    open(makeApp())
    expect(screen.getByText(/never triggers an entry/)).toBeInTheDocument()
  })

  it('the preview follows every edit', async () => {
    open(makeApp())
    await pick('Rule side', 'SELL')
    await pick('c left type', 'high')
    await pick('c direction', 'below')
    await userEvent.clear(screen.getByLabelText('Rule quantity'))
    await userEvent.type(screen.getByLabelText('Rule quantity'), '25')
    expect(screen.getByTestId('rule-preview')).toHaveTextContent('Sell 25 SBIN on the 1H chart when High crosses below EMA 20')
  })

  it('saves exactly what is on the screen', async () => {
    const app = makeApp()
    open(app)
    await userEvent.type(screen.getByLabelText('Rule name'), 'EMA reclaim')
    await pick('Rule timeframe', '15m')
    await pick('Stop type', 'pct')
    await userEvent.clear(screen.getByLabelText('Stop percent'))
    await userEvent.type(screen.getByLabelText('Stop percent'), '1.5')
    await pick('Target type', 'none')
    await userEvent.click(screen.getByLabelText(/Fire once/))
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(() => expect(app.api.saveRule).toHaveBeenCalledOnce())
    expect(saved(app)).toMatchObject({
      symbol: SBIN, timeframe: '15m', name: 'EMA reclaim', side: 'BUY', quantity: 1, once: true, enabled: true,
      condition: { type: 'cross', direction: 'above', a: { kind: 'close' }, b: { kind: 'indicator', name: 'ema', params: { period: 20 }, output: 'value' } },
      stop: { type: 'pct', value: 1.5 }, target: null,
    })
    await waitFor(() => expect(app.store.get().ruleDialog).toBeNull()) // closes after a successful save
    expect(app.store.get().rules.map((r) => r.name)).toContain('EMA reclaim')
  })

  it('edits an indicator’s parameters', async () => {
    const app = makeApp()
    open(app)
    await userEvent.clear(screen.getByLabelText('c right period'))
    await userEvent.type(screen.getByLabelText('c right period'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
    expect(saved(app).condition.b).toMatchObject({ kind: 'indicator', name: 'ema', params: { period: 50 } })
  })

  it('switching the indicator resets its parameters and offers its outputs', async () => {
    open(makeApp())
    await pick('c right indicator', 'macd')
    expect(screen.getByLabelText('c right fast')).toHaveValue(12)
    expect(within(screen.getByLabelText('c right output')).getAllByRole('option').map((o) => o.textContent)).toEqual(['macd', 'signal', 'histogram'])
  })

  describe('with lines drawn on the chart', () => {
    it('starts from a line: "enter when close crosses above this line"', async () => {
      const d = line({ label: 'Resistance' })
      const app = makeApp({}, { drawings: [d] })
      open(app, draftFromLine(d, '1H', 'above'))
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('Buy 1 SBIN on the 1H chart when Close crosses above line “Resistance”')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app)).toMatchObject({ side: 'BUY', condition: { type: 'cross', direction: 'above', a: { kind: 'close' }, b: { kind: 'line', drawing_id: 'd1' } } })
    })

    it('can use a line as the stop-loss', async () => {
      const app = makeApp({}, { drawings: [line({ id: 'support', kind: 'horizontal_line', label: 'Support' })] })
      open(app)
      await pick('Stop type', 'line')
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('stop at line “Support”')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).stop).toEqual({ type: 'line', drawing_id: 'support' })
    })

    it('refuses to save while a line is chosen but none exists', async () => {
      open(makeApp())
      await pick('c right type', 'line')
      expect(screen.getByRole('alert')).toHaveTextContent('Pick a line that exists on this chart.')
      expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled()
    })
  })

  describe('combining conditions', () => {
    it('turns a condition into an AND group and adds a second condition', async () => {
      const app = makeApp()
      open(app)
      await pick('c kind', 'all')
      await userEvent.click(screen.getByRole('button', { name: '+ condition' }))
      expect(screen.getByTestId('rule-preview')).toHaveTextContent("Close crosses above EMA 20 AND Close > 0.00")
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).condition.type).toBe('all')
      expect(saved(app).condition.conditions).toHaveLength(2)
    })

    it('keeps the existing condition when wrapping it in OR, and can remove one again', async () => {
      open(makeApp())
      await pick('c kind', 'any')
      await userEvent.click(screen.getByRole('button', { name: '+ condition' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove c.2' }))
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('when Close crosses above EMA 20;')
    })

    it('will not save an empty group', async () => {
      open(makeApp())
      await pick('c kind', 'all')
      await userEvent.click(screen.getByRole('button', { name: 'Remove c.1' }))
      expect(screen.getByRole('alert')).toHaveTextContent('A group needs at least one condition.')
      expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled()
    })
  })

  describe('catching mistakes before they reach the server', () => {
    it('quantity must be a whole number above zero', async () => {
      open(makeApp())
      await userEvent.clear(screen.getByLabelText('Rule quantity'))
      await userEvent.type(screen.getByLabelText('Rule quantity'), '0')
      expect(screen.getByRole('alert')).toHaveTextContent('Quantity must be a whole number above zero.')
      expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled()
    })

    it('a percentage stop must be positive', async () => {
      open(makeApp())
      await pick('Stop type', 'pct')
      await userEvent.clear(screen.getByLabelText('Stop percent'))
      await userEvent.type(screen.getByLabelText('Stop percent'), '-1')
      expect(screen.getByRole('alert')).toHaveTextContent('The stop percentage must be above zero.')
    })
  })

  it('stays open and shows the server’s message when saving fails', async () => {
    const app = makeApp({ saveRule: async () => { throw new Error('rule limit reached') } })
    open(app)
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(() => expect(app.store.get().toast?.text).toBe('rule limit reached'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeEnabled() // can retry
  })

  it('edits an existing rule in place', async () => {
    const app = makeApp({}, { drawings: [line()] })
    open(app, rule())
    expect(screen.getByRole('dialog', { name: 'Edit rule' })).toBeInTheDocument()
    expect(screen.getByLabelText('Rule name')).toHaveValue('Breakout')
    await userEvent.clear(screen.getByLabelText('Rule quantity'))
    await userEvent.type(screen.getByLabelText('Rule quantity'), '9')
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
    expect(saved(app)).toMatchObject({ id: 'r1', quantity: 9 })
  })

  describe('after entry', () => {
    it('has no trail or exit rule by default, and says so in what it saves', async () => {
      const app = makeApp()
      open(app)
      expect(screen.getByLabelText('Trail type')).toHaveValue('none')
      expect(screen.queryByLabelText('Exit timeframe')).not.toBeInTheDocument()
      expect(screen.getByTestId('rule-preview')).not.toHaveTextContent(/trail|exit when/)
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app)).toMatchObject({ trail: null, exit_condition: null, exit_timeframe: null })
    })

    it('saves an ATR trail on its own timeframe and reads it back in the preview', async () => {
      const app = makeApp()
      open(app)
      await pick('Trail type', 'atr')
      await userEvent.clear(screen.getByLabelText('Trail ATR multiple'))
      await userEvent.type(screen.getByLabelText('Trail ATR multiple'), '3')
      await pick('Trail timeframe', '30m')
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('trail 3×ATR(14) from the close on 30m candles')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).trail).toEqual({ type: 'atr', period: 14, mult: 3, timeframe: '30m' })
    })

    it('switching trail type keeps the chosen timeframe', async () => {
      open(makeApp())
      await pick('Trail type', 'pct')
      await pick('Trail timeframe', '1H')
      await pick('Trail type', 'candle')
      expect(screen.getByLabelText('Trail timeframe')).toHaveValue('1H')
    })

    it('trails along an indicator or a drawn line', async () => {
      const app = makeApp({}, { drawings: [line()] })
      open(app)
      await pick('Trail type', 'indicator')
      await userEvent.clear(screen.getByLabelText('Trail period'))
      await userEvent.type(screen.getByLabelText('Trail period'), '9')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).trail).toMatchObject({ type: 'indicator', name: 'ema', params: { period: 9 } })
    })

    it('a trail on a line needs a line, and the Save button waits for one', async () => {
      open(makeApp())
      await pick('Trail type', 'line')
      expect(screen.getByRole('alert')).toHaveTextContent('Pick a line for the trailing stop.')
      expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled()
    })

    it('an exit condition defaults to the opposite direction of the trade, and is checked on its own timeframe', async () => {
      const app = makeApp()
      open(app)
      await userEvent.click(screen.getByLabelText('Exit on a condition'))
      expect(screen.getByLabelText('x direction')).toHaveValue('below')
      await pick('Exit timeframe', '15m')
      await pick('x direction', 'above')
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('exit 50% when Close crosses above EMA 20 on 15m')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app)).toMatchObject({ exit_timeframe: '15m', exit_condition: { type: 'cross', direction: 'above', a: { kind: 'close' } } })
    })

    it('a short rule defaults its exit to a cross above', async () => {
      open(makeApp(), { ...newDraft(SBIN, '1H'), side: 'SELL' })
      await userEvent.click(screen.getByLabelText('Exit on a condition'))
      expect(screen.getByLabelText('x direction')).toHaveValue('above')
    })

    it('turning the exit condition off forgets its timeframe', async () => {
      const app = makeApp()
      open(app)
      await userEvent.click(screen.getByLabelText('Exit on a condition'))
      await pick('Exit timeframe', '15m')
      await userEvent.click(screen.getByLabelText('Exit on a condition'))
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app)).toMatchObject({ exit_condition: null, exit_timeframe: null })
    })

    it('opens an existing rule with its exit plan filled in', () => {
      open(makeApp(), { ...newDraft(SBIN, '1H'), id: 'r1', trail: { type: 'pct', value: 2 }, exit_condition: { type: 'compare', op: '<', a: { kind: 'close' }, b: { kind: 'value', value: 90 } }, exit_timeframe: '1D' })
      expect(screen.getByLabelText('Trail type')).toHaveValue('pct')
      expect(screen.getByLabelText('Trail percent')).toHaveValue(2)
      expect(screen.getByLabelText('Exit timeframe')).toHaveValue('1D')
      expect(screen.getByLabelText('x kind')).toHaveValue('compare')
    })
  })

  describe('zones', () => {
    const zone = line({ id: 'z1', kind: 'rectangle', label: 'supply', points: [{ time: T0, price: 110 }, { time: T0 + 3600, price: 104 }] })
    const note = line({ id: 'n1', kind: 'text', label: 'watch', points: [{ time: T0, price: 100 }] })

    it('asks which edge when the chosen drawing is a zone, and saves it', async () => {
      const app = makeApp({}, { drawings: [line(), zone, note] })
      open(app)
      await pick('c right type', 'line')
      expect(screen.queryByLabelText('c right line edge')).not.toBeInTheDocument() // a plain line has no edge
      await pick('c right line', 'z1')
      expect(screen.getByLabelText('c right line edge')).toHaveValue('top')
      await pick('c right line edge', 'bottom')
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('Close crosses above bottom of zone “supply”')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).condition.b).toEqual({ kind: 'line', drawing_id: 'z1', edge: 'bottom' })
    })

    it('never offers a text note as something to trade', async () => {
      open(makeApp({}, { drawings: [line(), zone, note] }))
      await pick('c right type', 'line')
      expect(within(screen.getByLabelText('c right line')).queryByText(/watch/)).not.toBeInTheDocument()
    })

    it('a zone can be the stop or the trail', async () => {
      const app = makeApp({}, { drawings: [zone] })
      open(app)
      await pick('Stop type', 'line')
      await pick('Stop line edge', 'bottom')
      await pick('Trail type', 'line')
      await pick('Trail line edge', 'top')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).stop).toMatchObject({ type: 'line', drawing_id: 'z1', edge: 'bottom' })
      expect(saved(app).trail).toMatchObject({ type: 'line', drawing_id: 'z1', edge: 'top' })
    })

    it('switching from a zone back to a line drops the edge', async () => {
      const app = makeApp({}, { drawings: [zone, line()] })
      open(app)
      await pick('Stop type', 'line')
      await pick('Stop line', 'd1')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).stop.edge).toBeUndefined()
    })
  })

  describe('range breakouts and time windows', () => {
    it('breaks out of the highest high of the last N candles', async () => {
      const app = makeApp()
      open(app)
      await pick('c right type', 'highest')
      await userEvent.clear(screen.getByLabelText('c right candles'))
      await userEvent.type(screen.getByLabelText('c right candles'), '30')
      expect(screen.getByLabelText('c right source')).toHaveValue('high')
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('Close crosses above 30-candle high')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).condition.b).toEqual({ kind: 'highest', bars: 30, source: 'high' })
    })

    it('the lowest low can be measured on another price', async () => {
      open(makeApp())
      await pick('c right type', 'lowest')
      await pick('c right source', 'close')
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('20-candle low of close')
    })

    it('a bad look-back keeps Save disabled', async () => {
      open(makeApp())
      await pick('c right type', 'highest')
      await userEvent.clear(screen.getByLabelText('c right candles'))
      expect(screen.getByRole('alert')).toHaveTextContent('Look back over 1 to 500 candles.')
      expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled()
    })

    it('adds a time window to an entry rule', async () => {
      const app = makeApp()
      open(app)
      await pick('c kind', 'all')
      await userEvent.click(screen.getByRole('button', { name: '+ condition' }))
      await pick('c.2 kind', 'time_between')
      fireEvent.change(screen.getByLabelText('c.2 from'), { target: { value: '09:30' } })
      fireEvent.change(screen.getByLabelText('c.2 to'), { target: { value: '11:00' } })
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('AND the candle closes between 09:30 and 11:00 IST')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).condition.conditions[1]).toEqual({ type: 'time_between', start: '09:30', end: '11:00' })
    })

    it('squares off at a time: an exit condition that is only about the clock', async () => {
      const app = makeApp()
      open(app)
      await userEvent.click(screen.getByLabelText('Exit on a condition'))
      await pick('x kind', 'time_between')
      fireEvent.change(screen.getByLabelText('x from'), { target: { value: '15:15' } })
      fireEvent.change(screen.getByLabelText('x to'), { target: { value: '15:30' } })
      expect(screen.getByTestId('rule-preview')).toHaveTextContent('exit 50% when the candle closes between 15:15 and 15:30 IST')
      await userEvent.click(screen.getByRole('button', { name: 'Save rule' }))
      await waitFor(() => expect(app.api.saveRule).toHaveBeenCalled())
      expect(saved(app).exit_condition).toEqual({ type: 'time_between', start: '15:15', end: '15:30' })
    })

    it('a backwards window is caught before saving', async () => {
      open(makeApp())
      await pick('c kind', 'time_between')
      fireEvent.change(screen.getByLabelText('c from'), { target: { value: '15:00' } })
      fireEvent.change(screen.getByLabelText('c to'), { target: { value: '10:00' } })
      expect(screen.getByRole('alert')).toHaveTextContent('cannot run past midnight')
    })
  })

  it('cancel closes without saving', async () => {
    const app = makeApp()
    open(app)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(app.store.get().ruleDialog).toBeNull()
    expect(app.api.saveRule).not.toHaveBeenCalled()
  })
})
