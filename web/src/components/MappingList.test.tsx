import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@solidjs/testing-library'
import { MappingList } from './MappingList'
import type { Mapping } from '../api/client'

const exampleMapping: Mapping = {
  id: 'abc',
  name: 'Console A',
  sourcePath: '/roms/console-a',
  destPath: '/dest/console-a',
  manualGroups: {},
  allowedExtensions: [],
}

describe('MappingList', () => {
  it('renders fallback when empty', () => {
    const { getByText } = render(() => <MappingList mappings={[]} onOpen={() => {}} />)
    expect(getByText(/No mappings yet/i)).toBeInTheDocument()
  })

  it('renders each mapping with its paths', () => {
    const { getByText } = render(() => (
      <MappingList mappings={[exampleMapping]} onOpen={() => {}} />
    ))
    expect(getByText('Console A')).toBeInTheDocument()
    expect(getByText('/roms/console-a → /dest/console-a')).toBeInTheDocument()
  })

  it('calls onOpen with the mapping id', () => {
    const fn = vi.fn()
    const { getByText } = render(() => <MappingList mappings={[exampleMapping]} onOpen={fn} />)
    fireEvent.click(getByText('OPEN'))
    expect(fn).toHaveBeenCalledWith('abc')
  })

  it('shows DEL button when onDelete is provided', () => {
    const fn = vi.fn()
    const { getByText } = render(() => (
      <MappingList mappings={[exampleMapping]} onOpen={() => {}} onDelete={fn} />
    ))
    fireEvent.click(getByText('DEL'))
    expect(fn).toHaveBeenCalledWith('abc')
  })
})
