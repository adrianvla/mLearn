// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'

describe('Select', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('keeps child option selects in sync with reactive value changes', async () => {
    const { Select } = await import('./Select')
    let setTheme!: (value: string) => void

    const dispose = render(() => {
      const [theme, updateTheme] = createSignal('glass-dark')
      setTheme = updateTheme

      return (
        <Select value={theme()} onChange={() => undefined}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="glass-dark">Glass Dark</option>
        </Select>
      )
    }, container)

    await Promise.resolve()

    const select = container.querySelector('select')
    expect(select?.value).toBe('glass-dark')

    setTheme('dark')
    await Promise.resolve()

    expect(select?.value).toBe('dark')

    dispose()
  })
})