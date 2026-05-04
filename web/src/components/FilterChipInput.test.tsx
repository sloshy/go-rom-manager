import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@solidjs/testing-library'
import { FilterChipInput } from './FilterChipInput'
import type { FilterChip } from '../lib/tags'

const findInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector('input.filter-chip-input__field') as HTMLInputElement | null
  if (!input) throw new Error('filter chip input field not found')
  return input
}

describe('FilterChipInput', () => {
  it('commits a bare positive token on space', () => {
    let chips: FilterChip[] = []
    const { container } = render(() => (
      <FilterChipInput chips={chips} onChange={(c) => (chips = c)} />
    ))
    const input = findInput(container)
    fireEvent.input(input, { target: { value: 'Gun ' } })
    expect(chips).toEqual([{ text: 'Gun', negative: false }])
  })

  it('commits a -prefixed negative token on space', () => {
    let chips: FilterChip[] = []
    const { container } = render(() => (
      <FilterChipInput chips={chips} onChange={(c) => (chips = c)} />
    ))
    fireEvent.input(findInput(container), { target: { value: '-Bad ' } })
    expect(chips).toEqual([{ text: 'Bad', negative: true }])
  })

  it('preserves whitespace inside a quoted token', () => {
    let chips: FilterChip[] = []
    const { container } = render(() => (
      <FilterChipInput chips={chips} onChange={(c) => (chips = c)} />
    ))
    fireEvent.input(findInput(container), {
      target: { value: '"Sample Title" ' },
    })
    expect(chips).toEqual([{ text: 'Sample Title', negative: false }])
  })

  it('commits the current draft on Enter', () => {
    let chips: FilterChip[] = []
    const { container } = render(() => (
      <FilterChipInput chips={chips} onChange={(c) => (chips = c)} />
    ))
    const input = findInput(container)
    fireEvent.input(input, { target: { value: 'Gun' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(chips).toEqual([{ text: 'Gun', negative: false }])
  })

  it('removes the last chip when Backspace is pressed on an empty draft', () => {
    let chips: FilterChip[] = [
      { text: 'Gun', negative: false },
      { text: 'Bad', negative: true },
    ]
    const { container } = render(() => (
      <FilterChipInput chips={chips} onChange={(c) => (chips = c)} />
    ))
    fireEvent.keyDown(findInput(container), { key: 'Backspace' })
    expect(chips).toEqual([{ text: 'Gun', negative: false }])
  })

  it('ignores duplicate chips silently', () => {
    let chips: FilterChip[] = [{ text: 'Gun', negative: false }]
    let calls = 0
    const { container } = render(() => (
      <FilterChipInput
        chips={chips}
        onChange={(c) => {
          calls++
          chips = c
        }}
      />
    ))
    fireEvent.input(findInput(container), { target: { value: 'Gun ' } })
    expect(chips).toEqual([{ text: 'Gun', negative: false }])
    expect(calls).toBe(0)
  })

  it('removes a chip when its X button is clicked', () => {
    let chips: FilterChip[] = [
      { text: 'Gun', negative: false },
      { text: 'Bad', negative: true },
    ]
    const { getByLabelText } = render(() => (
      <FilterChipInput chips={chips} onChange={(c) => (chips = c)} />
    ))
    fireEvent.click(getByLabelText('Remove negative filter Bad'))
    expect(chips).toEqual([{ text: 'Gun', negative: false }])
  })

  it('renders the trailing children slot', () => {
    const { getByText } = render(() => (
      <FilterChipInput chips={[]} onChange={() => {}}>
        <span>EXTRA SLOT</span>
      </FilterChipInput>
    ))
    expect(getByText('EXTRA SLOT')).toBeInTheDocument()
  })
})
