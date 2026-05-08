import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@solidjs/testing-library'
import { GameRow } from './GameRow'

describe('GameRow', () => {
  it('renders prefix and file count', () => {
    const { getByText } = render(() => (
      <GameRow
        prefix="Example Game 1"
        files={['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip']}
        state="unselected"
        isFileChecked={() => false}
      />
    ))
    expect(getByText('Example Game 1')).toBeInTheDocument()
    expect(getByText('2 files')).toBeInTheDocument()
  })

  it('applies selected style when state=selected', () => {
    const { container } = render(() => (
      <GameRow
        prefix="Example Game 2"
        files={['Example Game 2 (USA).zip']}
        state="selected"
        isFileChecked={() => true}
      />
    ))
    expect(container.querySelector('.game-row')).toHaveClass('is-selected')
  })

  it('applies orphan style when state=orphan', () => {
    const { container } = render(() => (
      <GameRow
        prefix="leftover.txt"
        files={['leftover.txt']}
        state="orphan"
        isFileChecked={() => true}
        disabled={true}
      />
    ))
    expect(container.querySelector('.game-row')).toHaveClass('is-orphan')
  })

  it('applies removing style when state=removing', () => {
    const { container } = render(() => (
      <GameRow
        prefix="Example Game 5 (USA).zip"
        files={['Example Game 5 (USA).zip']}
        state="removing"
        isFileChecked={() => true}
        disabled={true}
      />
    ))
    expect(container.querySelector('.game-row')).toHaveClass('is-removing')
  })

  it('calls onToggleFile when a file checkbox is clicked', () => {
    const fn = vi.fn()
    const { getByLabelText } = render(() => (
      <GameRow
        prefix="Example Game 3"
        files={['Example Game 3 (USA).zip']}
        state="unselected"
        isFileChecked={() => false}
        onToggleFile={fn}
      />
    ))
    fireEvent.click(getByLabelText('Example Game 3 (USA).zip'))
    expect(fn).toHaveBeenCalledWith('Example Game 3 (USA).zip')
  })

  it('calls onTogglePrefix when the prefix checkbox is clicked', () => {
    const fn = vi.fn()
    const { getByLabelText } = render(() => (
      <GameRow
        prefix="Example Game 4"
        files={['Example Game 4 (USA).zip']}
        state="unselected"
        isFileChecked={() => false}
        onTogglePrefix={fn}
      />
    ))
    fireEvent.click(getByLabelText('toggle Example Game 4'))
    expect(fn).toHaveBeenCalled()
  })

  it('renders bundles as one row each, labelled by stem when multi-file', () => {
    const { getByLabelText, queryByText } = render(() => (
      <GameRow
        prefix="Sample Title"
        files={['Sample Title (USA).bin', 'Sample Title (USA).cue']}
        bundles={[
          {
            label: 'Sample Title (USA)',
            files: ['Sample Title (USA).bin', 'Sample Title (USA).cue'],
            extensions: ['.bin', '.cue'],
          },
        ]}
        state="selected"
        isFileChecked={() => true}
        onToggleFile={() => {}}
      />
    ))
    // Bundle row labelled by stem (not any individual file).
    expect(getByLabelText('Sample Title (USA)')).toBeInTheDocument()
    // Individual files are NOT rendered as separate rows.
    expect(queryByText('Sample Title (USA).bin')).toBeNull()
    expect(queryByText('Sample Title (USA).cue')).toBeNull()
  })

  it('toggling a bundle calls onToggleFile with the bundle head file when no onToggleBundle', () => {
    const fn = vi.fn()
    const { getByLabelText } = render(() => (
      <GameRow
        prefix="Sample Title"
        files={['Sample Title (USA).bin', 'Sample Title (USA).cue']}
        bundles={[
          {
            label: 'Sample Title (USA)',
            files: ['Sample Title (USA).bin', 'Sample Title (USA).cue'],
            extensions: ['.bin', '.cue'],
          },
        ]}
        state="selected"
        isFileChecked={() => true}
        onToggleFile={fn}
      />
    ))
    fireEvent.click(getByLabelText('Sample Title (USA)'))
    expect(fn).toHaveBeenCalledWith('Sample Title (USA).bin')
  })

  it('toggling a bundle prefers onToggleBundle and passes every file', () => {
    const bundleFn = vi.fn()
    const fileFn = vi.fn()
    const { getByLabelText } = render(() => (
      <GameRow
        prefix="Sample Title"
        files={['Sample Title (USA).bin', 'Sample Title (USA).cue']}
        bundles={[
          {
            label: 'Sample Title (USA)',
            files: ['Sample Title (USA).bin', 'Sample Title (USA).cue'],
            extensions: ['.bin', '.cue'],
          },
        ]}
        state="selected"
        isFileChecked={() => true}
        onToggleFile={fileFn}
        onToggleBundle={bundleFn}
      />
    ))
    fireEvent.click(getByLabelText('Sample Title (USA)'))
    expect(bundleFn).toHaveBeenCalledWith(['Sample Title (USA).bin', 'Sample Title (USA).cue'])
    expect(fileFn).not.toHaveBeenCalled()
  })

  it('disables checkboxes when disabled is true', () => {
    const { getByLabelText } = render(() => (
      <GameRow
        prefix="orphan.txt"
        files={['orphan.txt']}
        state="orphan"
        isFileChecked={() => true}
        disabled={true}
      />
    ))
    expect(getByLabelText('orphan.txt')).toBeDisabled()
  })
})
