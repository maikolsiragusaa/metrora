import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CollectorProvenanceProfilesV1 } from '../contracts/v1/collector-provenance.js'
import {
  CollectorInventoryV1,
  collectorInventorySummaryV1,
  renderCollectorInventoryMarkdownV1,
} from './collector-inventory.js'
import { allProviderNames } from './index.js'

describe('CollectorInventoryV1', () => {
  it('covers the exact operational provider registry without duplicates', () => {
    const registered = [...allProviderNames()].sort()
    const inventoried = CollectorInventoryV1.entries.map(entry => entry.provider).sort()
    expect(inventoried).toEqual(registered)
    expect(new Set(inventoried).size).toBe(39)
  })

  it('points every collector at a real provider module and provider guide', () => {
    for (const entry of CollectorInventoryV1.entries) {
      expect(existsSync(join(process.cwd(), entry.modulePath)), entry.provider).toBe(true)
      expect(entry.documentationPath, entry.provider).not.toBeNull()
      expect(existsSync(join(process.cwd(), entry.documentationPath!)), entry.provider).toBe(true)
    }
  })

  it('tracks complete provider documentation coverage separately from evidence approval', () => {
    expect(collectorInventorySummaryV1()).toEqual({
      total: 39,
      approved: 4,
      priority: 8,
      pending: 27,
      documented: 39,
      documentationGaps: [],
    })
  })

  it('approves signed sharing only for collectors with path-specific provenance profiles', () => {
    const approved = CollectorInventoryV1.entries.filter(entry => entry.shareEligibility === 'approved')
    const approvedProfileIds = approved.flatMap(entry => entry.provenanceProfileIds).sort()
    const actualProfileIds = CollectorProvenanceProfilesV1.map(profile => profile.profileId).sort()
    expect(approved.map(entry => entry.provider)).toEqual(['claude', 'codex', 'gemini', 'zed'])
    expect(approvedProfileIds).toEqual(actualProfileIds)

    for (const entry of CollectorInventoryV1.entries) {
      if (entry.shareEligibility === 'approved') {
        expect(entry.reviewStatus).toBe('approved')
        expect(entry.reviewWave).toBe(0)
        expect(entry.automatedEvidence).toBe('parser-fixture-parity')
        expect(entry.manualValidation).toBe('not-blocking')
        expect(entry.provenanceProfileIds.length).toBeGreaterThan(0)
      } else {
        expect(entry.provenanceProfileIds).toEqual([])
        expect(entry.manualValidation).toBe('required-before-share')
      }
    }
  })

  it('keeps Cline CLI local-only until a separate signed-evidence review approves it', () => {
    const clineCli = CollectorInventoryV1.entries.find(entry => entry.provider === 'cline-cli')
    expect(clineCli).toMatchObject({
      reviewStatus: 'pending',
      shareEligibility: 'withheld',
      automatedEvidence: 'unassessed',
      manualValidation: 'required-before-share',
      provenanceProfileIds: [],
    })
  })

  it('keeps the checked-in audit document generated from the executable inventory', () => {
    const document = readFileSync(join(process.cwd(), 'docs/COLLECTOR_INVENTORY_V1.md'), 'utf-8').replace(/\r\n/g, '\n')
    expect(document).toBe(renderCollectorInventoryMarkdownV1())
  })

  it('is deeply immutable', () => {
    expect(Object.isFrozen(CollectorInventoryV1)).toBe(true)
    expect(Object.isFrozen(CollectorInventoryV1.entries)).toBe(true)
    for (const entry of CollectorInventoryV1.entries) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.provenanceProfileIds)).toBe(true)
    }
  })
})
