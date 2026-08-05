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
    expect(new Set(inventoried).size).toBe(38)
  })

  it('points every collector at a real provider module and every claimed document at a real file', () => {
    for (const entry of CollectorInventoryV1.entries) {
      expect(existsSync(join(process.cwd(), entry.modulePath)), entry.provider).toBe(true)
      if (entry.documentationPath) {
        expect(existsSync(join(process.cwd(), entry.documentationPath)), entry.provider).toBe(true)
      }
    }
  })

  it('tracks the current documentation gaps explicitly', () => {
    expect(collectorInventorySummaryV1()).toEqual({
      total: 38,
      approved: 4,
      priority: 8,
      pending: 26,
      documented: 34,
      documentationGaps: ['codebuff', 'kimicode', 'open-design', 'quickdesk'],
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

  it('keeps the checked-in audit document generated from the executable inventory', () => {
    const document = readFileSync(join(process.cwd(), 'docs/COLLECTOR_INVENTORY_V1.md'), 'utf-8')
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
