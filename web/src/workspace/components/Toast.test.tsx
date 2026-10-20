import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeApp, renderIn } from './testharness'
import { ToastHost } from './Toast'

afterEach(() => vi.useRealTimers())

describe('ToastHost', () => {
  it('shows nothing until there is something to say', () => {
    renderIn(<ToastHost />, makeApp())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces errors as alerts and others as status', () => {
    const app = makeApp()
    renderIn(<ToastHost />, app)
    act(() => app.ctl.notify('error', 'Something broke'))
    expect(screen.getByRole('alert')).toHaveTextContent('Something broke')
    act(() => app.ctl.notify('success', 'Saved'))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('goes away when clicked', async () => {
    const app = makeApp()
    renderIn(<ToastHost />, app)
    act(() => app.ctl.notify('info', 'Hello'))
    await userEvent.click(screen.getByText('Hello'))
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
  })

  it('goes away by itself, errors a little later than the rest', () => {
    vi.useFakeTimers()
    const app = makeApp()
    renderIn(<ToastHost />, app)
    act(() => app.ctl.notify('info', 'Fyi'))
    act(() => { vi.advanceTimersByTime(5100) })
    expect(screen.queryByText('Fyi')).not.toBeInTheDocument()
    act(() => app.ctl.notify('error', 'Problem'))
    act(() => { vi.advanceTimersByTime(5100) })
    expect(screen.getByText('Problem')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.queryByText('Problem')).not.toBeInTheDocument()
  })
})
