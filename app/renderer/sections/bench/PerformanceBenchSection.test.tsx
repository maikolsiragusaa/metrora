// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ComponentStatus } from '../../lib/metrora-bridge-types'
import { PerformanceBenchSection } from './PerformanceBenchSection'

function componentStatus(backend: 'cpu' | 'metal', variant: 'cpu' | 'metal-capable', state: ComponentStatus['state'] = 'not-installed'): ComponentStatus {
  return {
    schemaVersion: 'metrora.component.v1',
    id: 'llama-bench',
    name: 'llama.cpp benchmark runtime',
    state,
    phase: state === 'installed' ? 'installed' : 'idle',
    version: 'b10621',
    backend,
    variant,
    progress: state === 'installed' ? 100 : null,
    detail: 'Managed artifact status.',
    executablePath: state === 'installed' ? 'C:\\managed\\llama-bench' : null,
    provenance: null,
    error: null,
  }
}

function renderSection(component: ComponentStatus) {
  return render(<PerformanceBenchSection
    history={[]}
    invalidCount={0}
    loading={false}
    executablePath=""
    modelPath=""
    component={component}
    running={false}
    comparison={null}
    comparisonLoading={false}
    leftRunId=""
    rightRunId=""
    onChooseExecutable={() => undefined}
    onChooseModel={() => undefined}
    onInstallComponent={() => undefined}
    onCancelComponent={() => undefined}
    onRun={() => undefined}
    onCancel={() => undefined}
    onLeftRunChange={() => undefined}
    onRightRunChange={() => undefined}
  />)
}

describe('Performance managed artifact capability presentation', () => {
  it('derives the Metal-capable label and action from component provenance metadata', () => {
    renderSection(componentStatus('metal', 'metal-capable'))

    expect(screen.getByText('llama.cpp benchmark runtime · Metal-capable')).toBeInTheDocument()
    expect(screen.getByText('Official Metrora-managed Metal-capable artifact')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install Metal-capable component' })).toBeInTheDocument()
  })

  it('keeps observed execution authority separate from artifact capability', () => {
    renderSection(componentStatus('metal', 'metal-capable', 'installed'))

    expect(screen.getByText(/artifact capability does not prove the backend or offload used by a run/)).toBeInTheDocument()
    expect(screen.getByText(/Retained Performance evidence remains authoritative for observed execution/)).toBeInTheDocument()
  })
})
