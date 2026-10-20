import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PRESETS } from '../lib/theme'
import { ThemeMenu } from './ThemeMenu'
import { makeApp, renderIn } from './testharness'

describe('ThemeMenu', () => {
  it('switches preset', async () => {
    const app = makeApp()
    renderIn(<ThemeMenu />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'Light')
    expect(app.store.get().theme).toEqual(PRESETS.Light)
  })
  it('lets any colour be edited, which makes the theme Custom', async () => {
    const app = makeApp()
    renderIn(<ThemeMenu />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    fireEvent.change(screen.getByLabelText('Up candle'), { target: { value: '#00ff00' } })
    expect(app.store.get().theme.up).toBe('#00ff00')
    expect(screen.getByLabelText('Preset')).toHaveValue('Custom')
  })
  it('resets to black', async () => {
    const app = makeApp({}, { theme: PRESETS.Light })
    renderIn(<ThemeMenu />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Theme' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset to black' }))
    expect(app.store.get().theme).toEqual(PRESETS.Black)
  })
})
