// The vertical strip of drawing tools at the chart's left edge.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DrawingRail } from './DrawingRail'
import { makeApp, renderIn } from './testharness'

describe('DrawingRail', () => {
  it('selects a drawing tool', async () => {
    const app = makeApp()
    renderIn(<DrawingRail />, app)
    await userEvent.click(screen.getByRole('button', { name: 'Trend line' }))
    expect(app.store.get().tool).toBe('trend_line')
    expect(screen.getByRole('button', { name: 'Trend line' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Cursor' }))
    expect(app.store.get().tool).toBe('cursor')
  })

  it.each([['Ray', 'ray'], ['Level', 'horizontal_line'], ['Zone', 'rectangle'], ['Text', 'text']])('%s picks the %s tool', async (name, tool) => {
    const app = makeApp()
    renderIn(<DrawingRail />, app)
    await userEvent.click(screen.getByRole('button', { name }))
    expect(app.store.get().tool).toBe(tool)
  })

  it('offers every kind of drawing and marks only the active tool', () => {
    renderIn(<DrawingRail />, makeApp())
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Cursor', 'Trend line', 'Ray', 'Level', 'Zone', 'Text'])
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })
})
