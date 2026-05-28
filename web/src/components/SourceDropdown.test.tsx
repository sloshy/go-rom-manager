import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@solidjs/testing-library'
import { SourceDropdown } from './SourceDropdown'

describe('SourceDropdown', () => {
  it('renders a static label (no menu) for a single source', () => {
    const { queryByRole, getByText } = render(() => (
      <SourceDropdown sources={['/roms/a']} active="/roms/a" primary="" onSelect={() => {}} />
    ))
    expect(getByText('a')).toBeInTheDocument()
    // No toggle button when there's nothing to switch to.
    expect(queryByRole('button')).toBeNull()
  })

  it('opens a menu and selects another source', () => {
    const onSelect = vi.fn()
    const { getByRole, getByText } = render(() => (
      <SourceDropdown
        sources={['/roms/a', '/roms/b']}
        active="/roms/a"
        primary="/roms/b"
        onSelect={onSelect}
      />
    ))
    fireEvent.click(getByRole('button'))
    // The menu lists both sources; the primary is badged.
    expect(getByText('PRIMARY')).toBeInTheDocument()
    fireEvent.click(getByText('b'))
    expect(onSelect).toHaveBeenCalledWith('/roms/b')
  })
})
