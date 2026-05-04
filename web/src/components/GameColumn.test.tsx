import { describe, expect, it } from 'vitest'
import { render, fireEvent } from '@solidjs/testing-library'
import { GameColumn } from './GameColumn'

const exampleGroups = [
  { prefix: 'Example Game 1', files: ['Example Game 1 (USA).zip', 'Example Game 1 (Japan).zip'] },
  { prefix: 'Example Game 2', files: ['Example Game 2 (World) (Rev 2).zip'] },
]

describe('GameColumn', () => {
  it('renders all groups in source mode', () => {
    const { getByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        isFileSelected={() => false}
      />
    ))
    expect(getByText('Example Game 1')).toBeInTheDocument()
    expect(getByText('Example Game 2')).toBeInTheDocument()
  })

  it('filters groups by chip-style positive substrings', () => {
    const { getByPlaceholderText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        isFileSelected={() => false}
      />
    ))
    const filter = getByPlaceholderText('type to filter...') as HTMLInputElement
    // Trailing space commits both tokens. Each chip is an AND substring.
    fireEvent.input(filter, { target: { value: 'Game 2 ' } })
    expect(queryByText('Example Game 1')).toBeNull()
    expect(queryByText('Example Game 2')).toBeInTheDocument()
  })

  it('treats a quoted span as a single multi-word chip', () => {
    const { getByPlaceholderText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        isFileSelected={() => false}
      />
    ))
    const filter = getByPlaceholderText('type to filter...') as HTMLInputElement
    fireEvent.input(filter, { target: { value: '"Game 1"' } })
    expect(queryByText('Example Game 1')).toBeInTheDocument()
    expect(queryByText('Example Game 2')).toBeNull()
  })

  it('renders extra (orange) files separately on destination side', () => {
    const { getByText } = render(() => (
      <GameColumn
        title="DEST"
        side="destination"
        groups={exampleGroups}
        extraFiles={['systems.txt']}
        isFileSelected={() => false}
      />
    ))
    expect(getByText('EXTRA FILES (NO SOURCE COUNTERPART)')).toBeInTheDocument()
  })

  it('renders to-be-removed (red) files separately on destination side', () => {
    const { getByText, container } = render(() => (
      <GameColumn
        title="DEST"
        side="destination"
        groups={exampleGroups}
        filesToRemove={['Example Game 3 (USA).zip']}
        isFileSelected={() => false}
      />
    ))
    expect(getByText('TO BE REMOVED ON SYNC')).toBeInTheDocument()
    expect(container.querySelector('.game-row.is-removing')).not.toBeNull()
  })

  it('does not render extras or removals in source mode', () => {
    const { queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        extraFiles={['systems.txt']}
        filesToRemove={['Example Game 3 (USA).zip']}
        isFileSelected={() => false}
      />
    ))
    expect(queryByText('EXTRA FILES (NO SOURCE COUNTERPART)')).toBeNull()
    expect(queryByText('TO BE REMOVED ON SYNC')).toBeNull()
  })

  it('filters removals and extras by the same chip query as groups', () => {
    const { getByPlaceholderText, queryAllByText } = render(() => (
      <GameColumn
        title="DEST"
        side="destination"
        groups={[]}
        filesToRemove={['alpha.zip', 'beta.zip']}
        extraFiles={['gamma.txt']}
        isFileSelected={() => false}
      />
    ))
    const filter = getByPlaceholderText('type to filter...') as HTMLInputElement
    fireEvent.input(filter, { target: { value: 'alpha ' } })
    expect(queryAllByText('alpha.zip').length).toBeGreaterThan(0)
    expect(queryAllByText('beta.zip').length).toBe(0)
    expect(queryAllByText('gamma.txt').length).toBe(0)
  })

  it('supports negative -"..." chips that hide matching prefixes', () => {
    const { getByPlaceholderText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        isFileSelected={() => false}
      />
    ))
    const filter = getByPlaceholderText('type to filter...') as HTMLInputElement
    fireEvent.input(filter, { target: { value: '-"Game 2"' } })
    expect(queryByText('Example Game 1')).toBeInTheDocument()
    expect(queryByText('Example Game 2')).toBeNull()
  })

  it('combines a positive chip with a negative chip', () => {
    const { getByPlaceholderText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={[
          { prefix: 'Sample Alpha', files: ['Sample Alpha (USA).zip'] },
          { prefix: 'Sample Alpha Beta', files: ['Sample Alpha Beta (USA).zip'] },
          { prefix: 'Sample Gamma', files: ['Sample Gamma (USA).zip'] },
        ]}
        isFileSelected={() => false}
      />
    ))
    const filter = getByPlaceholderText('type to filter...') as HTMLInputElement
    fireEvent.input(filter, { target: { value: 'Alpha -Beta ' } })
    expect(queryByText('Sample Alpha')).toBeInTheDocument()
    expect(queryByText('Sample Alpha Beta')).toBeNull()
    expect(queryByText('Sample Gamma')).toBeNull()
  })

  it('hides groups missing a positive-tag match by default', () => {
    const { getByText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={[
          { prefix: 'Example Game 1', files: ['Example Game 1 (Japan).zip'] },
          { prefix: 'Example Game 2', files: ['Example Game 2 (USA).zip'] },
        ]}
        isFileSelected={() => false}
      />
    ))
    fireEvent.click(getByText(/TAG FILTERS/))
    fireEvent.click(getByText('USA'))
    expect(queryByText('Example Game 1')).toBeNull()
    expect(queryByText('Example Game 2')).toBeInTheDocument()
  })

  it('hides groups containing a negative-tag match by default', () => {
    const { getByText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={[
          { prefix: 'Example Game 1', files: ['Example Game 1 (USA).zip'] },
          { prefix: 'Example Game 2', files: ['Example Game 2 (Demo).zip'] },
        ]}
        isFileSelected={() => false}
      />
    ))
    fireEvent.click(getByText(/TAG FILTERS/))
    // First click → positive, second → negative.
    fireEvent.click(getByText('Demo'))
    fireEvent.click(getByText('Demo'))
    expect(queryByText('Example Game 1')).toBeInTheDocument()
    expect(queryByText('Example Game 2')).toBeNull()
  })

  it('with grouped-items toggle, filters individual files within a group', () => {
    const groups = [
      {
        prefix: 'Example Game',
        files: ['Example Game (USA).zip', 'Example Game (Japan).zip'],
      },
    ]
    const { getByText, getByLabelText, queryByText } = render(() => (
      <GameColumn title="SOURCE" side="source" groups={groups} isFileSelected={() => false} />
    ))
    fireEvent.click(getByText(/TAG FILTERS/))
    const grouped = getByLabelText(/Filter grouped items/i, {
      exact: false,
    }) as HTMLInputElement
    fireEvent.click(grouped)
    fireEvent.click(getByText('USA'))
    // Group is still shown (USA file survives) but Japan file is hidden.
    expect(queryByText('Example Game')).toBeInTheDocument()
    expect(queryByText('Example Game (USA).zip')).toBeInTheDocument()
    expect(queryByText('Example Game (Japan).zip')).toBeNull()
  })

  it('auto-select honours the filtered subset in grouped-items mode', () => {
    const groups = [
      {
        prefix: 'Example Game',
        files: ['Example Game (USA).zip', 'Example Game (Japan).zip'],
      },
    ]
    const captured: string[][] = []
    const { getByText, getByLabelText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={groups}
        isFileSelected={() => false}
        onTogglePrefix={(files) => captured.push(files)}
      />
    ))
    fireEvent.click(getByText(/TAG FILTERS/))
    const grouped = getByLabelText(/Filter grouped items/i, {
      exact: false,
    }) as HTMLInputElement
    fireEvent.click(grouped)
    fireEvent.click(getByText('Japan'))
    // Click the prefix checkbox — only the Japan-tagged file should
    // reach the togglePrefix handler.
    fireEvent.click(getByLabelText('toggle Example Game'))
    expect(captured).toHaveLength(1)
    expect(captured[0]).toEqual(['Example Game (Japan).zip'])
  })
})
