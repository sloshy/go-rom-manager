import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { PreferenceEditor } from './PreferenceEditor'

describe('PreferenceEditor', () => {
  it('renders one input per item with rank labels', () => {
    const { getAllByRole, getByText } = render(() => (
      <PreferenceEditor items={['USA', 'World']} onChange={() => {}} />
    ))
    const inputs = getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    expect(inputs[0].value).toBe('USA')
    expect(inputs[1].value).toBe('World')
    expect(getByText('1.')).toBeInTheDocument()
    expect(getByText('2.')).toBeInTheDocument()
  })

  it('emits onChange when an input is edited', () => {
    const fn = vi.fn()
    const { getAllByRole } = render(() => <PreferenceEditor items={['USA']} onChange={fn} />)
    const input = getAllByRole('textbox')[0] as HTMLInputElement
    fireEvent.input(input, { target: { value: 'Japan' } })
    expect(fn).toHaveBeenCalledWith(['Japan'])
  })

  it('appends a blank entry when ADD is clicked', () => {
    const fn = vi.fn()
    const { getByText } = render(() => <PreferenceEditor items={['USA']} onChange={fn} />)
    fireEvent.click(getByText(/ADD PREFERENCE/i))
    expect(fn).toHaveBeenCalledWith(['USA', ''])
  })

  it('removes an entry when its X button is clicked', () => {
    const fn = vi.fn()
    const { getAllByLabelText } = render(() => (
      <PreferenceEditor items={['USA', 'World']} onChange={fn} />
    ))
    const removes = getAllByLabelText(/Remove preference/i)
    fireEvent.click(removes[0])
    expect(fn).toHaveBeenCalledWith(['World'])
  })

  it('flags case-insensitive duplicates', () => {
    const { getByText } = render(() => (
      <PreferenceEditor items={['USA', 'usa']} onChange={() => {}} />
    ))
    expect(getByText(/Duplicate entries/i)).toBeInTheDocument()
  })

  it('shows the empty fallback when given no items', () => {
    const { getByText } = render(() => <PreferenceEditor items={[]} onChange={() => {}} />)
    expect(getByText(/No preferences/i)).toBeInTheDocument()
  })

  it('disables inputs and buttons when disabled', () => {
    const { getAllByRole, getByText } = render(() => (
      <PreferenceEditor items={['USA']} onChange={() => {}} disabled />
    ))
    const input = getAllByRole('textbox')[0] as HTMLInputElement
    expect(input.disabled).toBe(true)
    const add = getByText(/ADD PREFERENCE/i) as HTMLButtonElement
    expect(add.disabled).toBe(true)
  })

  it('reorders items via simulated drag-drop on handles', () => {
    const [items, setItems] = createSignal(['A', 'B', 'C'])
    const { container } = render(() => (
      <PreferenceEditor items={items()} onChange={(next) => setItems(next)} />
    ))
    const handles = container.querySelectorAll('.pref-handle')
    const rows = container.querySelectorAll('.pref-item')
    expect(handles.length).toBe(3)

    // jsdom omits DataTransfer; the component tracks the drag source via its
    // own signal, so we just need the events to fire in order.
    fireEvent.dragStart(handles[0])
    fireEvent.dragOver(rows[2])
    fireEvent.drop(rows[2])

    expect(items()).toEqual(['B', 'C', 'A'])
  })
})
