import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { makeApp, renderIn } from './testharness'
import { SymbolSearch } from './SymbolSearch'

const hit = (s: string, name: string) => ({ symbol: `NSE:${s}-EQ`, exchange: 'NSE', name, sector: 'Banks' })

describe('SymbolSearch', () => {
  it('searches as you type and shows company names', async () => {
    const app = makeApp({ searchSymbols: vi.fn(async () => [hit('HDFCBANK', 'HDFC Bank'), hit('HDFCLIFE', 'HDFC Life')]) })
    renderIn(<SymbolSearch onPick={() => {}} />, app)
    await userEvent.type(screen.getByLabelText('Search symbols'), 'hdfc')
    expect(await screen.findByText('HDFC Bank')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(app.api.searchSymbols).toHaveBeenLastCalledWith('hdfc')
  })

  it('waits for a pause in typing instead of searching on every key', async () => {
    const app = makeApp()
    renderIn(<SymbolSearch onPick={() => {}} />, app)
    await userEvent.type(screen.getByLabelText('Search symbols'), 'reliance')
    await waitFor(() => expect(app.api.searchSymbols).toHaveBeenCalled())
    expect(app.api.searchSymbols.mock.calls.length).toBeLessThan(3)
  })

  it('ignores a slow answer to an older query', async () => {
    let release: (v: ReturnType<typeof hit>[]) => void = () => {}
    const slow = new Promise<ReturnType<typeof hit>[]>((r) => { release = r })
    const search = vi.fn()
      .mockImplementationOnce(() => slow)
      .mockImplementationOnce(async () => [hit('TCS', 'Tata Consultancy')])
    renderIn(<SymbolSearch onPick={() => {}} />, makeApp({ searchSymbols: search }))
    const box = screen.getByLabelText('Search symbols')
    await userEvent.type(box, 'a')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    await userEvent.type(box, 'b')
    expect(await screen.findByText('Tata Consultancy')).toBeInTheDocument()
    release([hit('OLD', 'Stale Result')])
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Stale Result')).not.toBeInTheDocument()
  })

  it('picks with the mouse and clears the box', async () => {
    const picked: string[] = []
    renderIn(<SymbolSearch onPick={(s) => picked.push(s)} />, makeApp({ searchSymbols: async () => [hit('SBIN', 'State Bank')] }))
    await userEvent.type(screen.getByLabelText('Search symbols'), 'sbi')
    await userEvent.click(await screen.findByRole('option', { name: /SBIN/ }))
    expect(picked).toEqual(['NSE:SBIN-EQ'])
    expect(screen.getByLabelText('Search symbols')).toHaveValue('')
  })

  it('picks with the keyboard: arrows move, Enter chooses', async () => {
    const picked: string[] = []
    renderIn(<SymbolSearch onPick={(s) => picked.push(s)} />, makeApp({ searchSymbols: async () => [hit('A', 'Alpha'), hit('B', 'Beta')] }))
    await userEvent.type(screen.getByLabelText('Search symbols'), 'x')
    await screen.findByText('Beta')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(picked).toEqual(['NSE:B-EQ'])
  })

  it('accepts a full EXCHANGE:SYMBOL typed by hand when the symbols table has no match', async () => {
    const picked: string[] = []
    renderIn(<SymbolSearch onPick={(s) => picked.push(s)} />, makeApp())
    await userEvent.type(screen.getByLabelText('Search symbols'), 'mcx:silverm26dec fut{Backspace}{Backspace}{Backspace}{Backspace}')
    await userEvent.keyboard('{Enter}')
    expect(picked).toEqual(['MCX:SILVERM26DEC'])
  })

  it('survives a failed search', async () => {
    renderIn(<SymbolSearch onPick={() => {}} />, makeApp({ searchSymbols: async () => { throw new Error('down') } }))
    await userEvent.type(screen.getByLabelText('Search symbols'), 'abc')
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
