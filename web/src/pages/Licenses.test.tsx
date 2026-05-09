import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent } from '@solidjs/testing-library'
import { LicenseGroup } from './Licenses'
import type { LicenseEntry } from '../api/client'

const sample: LicenseEntry[] = [
  { name: 'pkg-a', version: '1.0.0', license: 'MIT', text: 'pkg-a license body' },
  { name: 'pkg-b', version: '2.0.0', license: 'BSD-3-Clause', text: 'pkg-b license body' },
]

describe('LicenseGroup', () => {
  it('renders an entry per dependency with name, version, and license', () => {
    const { getByText } = render(() => (
      <LicenseGroup label="Go" entries={sample} openKey={null} onToggle={() => {}} keyPrefix="go" />
    ))
    expect(getByText('pkg-a')).toBeInTheDocument()
    expect(getByText('1.0.0')).toBeInTheDocument()
    expect(getByText('MIT')).toBeInTheDocument()
    expect(getByText('pkg-b')).toBeInTheDocument()
    expect(getByText('BSD-3-Clause')).toBeInTheDocument()
  })

  it('hides license body until the row is opened', () => {
    const { queryByText } = render(() => (
      <LicenseGroup label="Go" entries={sample} openKey={null} onToggle={() => {}} keyPrefix="go" />
    ))
    expect(queryByText('pkg-a license body')).not.toBeInTheDocument()
  })

  it('shows license body when openKey matches the entry', () => {
    const { getByText } = render(() => (
      <LicenseGroup
        label="Go"
        entries={sample}
        openKey="go:pkg-a@1.0.0"
        onToggle={() => {}}
        keyPrefix="go"
      />
    ))
    expect(getByText('pkg-a license body')).toBeInTheDocument()
  })

  it('calls onToggle with the per-entry key', () => {
    const fn = vi.fn()
    const { getByText } = render(() => (
      <LicenseGroup label="Go" entries={sample} openKey={null} onToggle={fn} keyPrefix="go" />
    ))
    fireEvent.click(getByText('pkg-b'))
    expect(fn).toHaveBeenCalledWith('go:pkg-b@2.0.0')
  })

  it('renders a placeholder when there are no matches', () => {
    const { getByText } = render(() => (
      <LicenseGroup label="Go" entries={[]} openKey={null} onToggle={() => {}} keyPrefix="go" />
    ))
    expect(getByText('// no matches')).toBeInTheDocument()
  })
})
