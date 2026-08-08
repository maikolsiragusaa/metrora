import { describe, expect, it } from 'vitest'

import {
  EndpointV1Schema,
  JSON_SCHEMA_DIALECT_2020_12,
  MeasurementBatchV1Schema,
  PublicContractJsonSchemasV1,
  RepositoryIdentityV1Schema,
  SharingPolicyV1Schema,
  UsageMeasurementEventV1Schema,
  WorkspaceV1Schema,
  parseUsageEvidenceStatementV1,
} from './index.js'

const NOW = '2026-07-31T12:00:00.000Z'
const LATER = '2026-07-31T12:30:00.000Z'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function usageEvent() {
  return {
    specversion: '1.0',
    id: 'evt_01',
    source: 'urn:metrora:endpoint:endpoint_01',
    type: 'dev.metrora.measurement.ai-usage.v1',
    time: NOW,
    subject: 'workspace/workspace_01/repository/repository_01',
    datacontenttype: 'application/json',
    dataschema: 'https://schemas.metrora.dev/v1/usage-measurement.schema.json',
    data: {
      version: 1,
      workspaceId: 'workspace_01',
      endpointId: 'endpoint_01',
      repositoryId: 'repository_01',
      projectId: 'project_01',
      sessionId: 'session_01',
      accountId: 'account_01',
      tool: { name: 'Codex', version: '1.0.0' },
      collector: {
        adapterId: 'adapter_codex',
        adapterVersion: '1.0.0',
        sourceKind: 'jsonl-session',
        sourceFingerprintSha256: SHA_A,
      },
      genAi: {
        operationName: 'invoke_agent',
        providerName: 'openai',
        requestModel: 'gpt-5.6-luna',
        responseModel: 'gpt-5.6-luna',
      },
      usage: {
        calls: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        reasoningTokens: 5,
      },
      cost: {
        kind: 'estimated',
        amountMicrosUsd: 1200,
        method: 'token-pricing',
      },
      reasoning: { level: 'xhigh', source: 'explicit' },
      quality: {
        tokenCounts: 'measured',
        modelIdentity: 'exact',
        sessionIdentity: 'exact',
      },
      privacy: {
        promptsIncluded: false,
        responsesIncluded: false,
        sourceCodeIncluded: false,
        patchesIncluded: false,
        secretsIncluded: false,
        localPathsIncluded: false,
      },
    },
  } as const
}

describe('public contracts v1', () => {
  it('exports strict JSON Schema Draft 2020-12 documents', () => {
    for (const [name, schema] of Object.entries(PublicContractJsonSchemasV1)) {
      expect(schema.$schema, name).toBe(JSON_SCHEMA_DIALECT_2020_12)
      expect(schema.$id, name).toMatch(/^https:\/\/schemas\.metrora\.dev\/v1\/.+\.schema\.json$/)
      expect(schema.type, name).toBe('object')
      expect(schema.additionalProperties, name).toBe(false)
    }
  })

  it('keeps workspace records opaque and rejects undeclared data', () => {
    const workspace = {
      kind: 'metrora.workspace',
      version: 1,
      workspaceId: 'workspace_01',
      slug: 'maikol-lab',
      displayName: 'Maikol Lab',
      ownership: 'personal',
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(WorkspaceV1Schema.parse(workspace)).toEqual(workspace)
    expect(WorkspaceV1Schema.safeParse({ ...workspace, email: 'hidden@example.test' }).success).toBe(false)
  })

  it('requires enrollment evidence appropriate to the endpoint state', () => {
    const endpoint = {
      kind: 'metrora.endpoint',
      version: 1,
      endpointId: 'endpoint_01',
      workspaceId: 'workspace_01',
      displayName: 'Windows workstation',
      endpointType: 'desktop',
      platform: { os: 'windows', architecture: 'x64' },
      identity: { keyAlgorithm: 'ecdsa-p256', publicKeyFingerprintSha256: SHA_A },
      software: { metroraVersion: '0.1.0', collectorVersion: '0.1.0' },
      capabilities: ['collect', 'normalize', 'aggregate', 'serve-local-api'],
      enrollment: { state: 'active', requestedAt: NOW, enrolledAt: LATER },
      createdAt: NOW,
      updatedAt: LATER,
      lastSeenAt: LATER,
    }
    expect(EndpointV1Schema.safeParse(endpoint).success).toBe(true)
    expect(EndpointV1Schema.safeParse({
      ...endpoint,
      enrollment: { state: 'active', requestedAt: NOW },
    }).success).toBe(false)
  })

  it('rejects repository remotes containing embedded credentials', () => {
    const base = {
      kind: 'metrora.repository-identity',
      version: 1,
      repositoryId: 'repository_01',
      workspaceId: 'workspace_01',
      vcs: 'git',
      displayName: 'metrora',
      defaultBranch: 'main',
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(RepositoryIdentityV1Schema.safeParse({
      ...base,
      locator: {
        mode: 'remote',
        canonicalUrl: 'https://github.com/maikolsiragusaa/metrora.git',
        canonicalUrlSha256: SHA_A,
        host: 'github.com',
        owner: 'maikolsiragusaa',
        name: 'metrora',
      },
    }).success).toBe(true)
    expect(RepositoryIdentityV1Schema.safeParse({
      ...base,
      locator: {
        mode: 'remote',
        canonicalUrl: 'https://token@github.com/maikolsiragusaa/metrora.git',
        canonicalUrlSha256: SHA_A,
      },
    }).success).toBe(false)
  })

  it('makes raw content impossible to authorize in sharing policy v1', () => {
    const policy = {
      kind: 'metrora.sharing-policy',
      version: 1,
      policyId: 'policy_01',
      workspaceId: 'workspace_01',
      revision: 1,
      status: 'active',
      recipient: { type: 'endpoint', endpointIds: ['endpoint_phone'] },
      datasets: ['aggregate-usage', 'model-usage'],
      window: { type: 'rolling-days', days: 30 },
      disclosure: {
        repositoryIdentity: 'opaque-id',
        sessionIdentity: 'none',
        localPaths: 'none',
        prompts: 'none',
        responses: 'none',
        sourceCode: 'none',
        patches: 'none',
        secrets: 'none',
      },
      limits: { minimumRefreshSeconds: 30, maximumRecordsPerResponse: 1000 },
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(SharingPolicyV1Schema.safeParse(policy).success).toBe(true)
    expect(SharingPolicyV1Schema.safeParse({
      ...policy,
      disclosure: { ...policy.disclosure, prompts: 'full' },
    }).success).toBe(false)
  })

  it('accepts CloudEvents usage facts but rejects prompt or path leakage', () => {
    const event = usageEvent()
    expect(UsageMeasurementEventV1Schema.safeParse(event).success).toBe(true)
    expect(UsageMeasurementEventV1Schema.safeParse({
      ...event,
      data: { ...event.data, prompt: 'do not export me' },
    }).success).toBe(false)

    const batch = {
      kind: 'metrora.measurement-batch',
      version: 1,
      batchId: 'batch_01',
      createdAt: NOW,
      producer: {
        endpointId: 'endpoint_01',
        metroraVersion: '0.1.0',
        adapterSetSha256: SHA_B,
      },
      semanticConventions: {
        cloudEvents: '1.0',
        openTelemetryGenAi: { version: '1.42.0', stability: 'development' },
        metrora: '1',
      },
      events: [event],
    }
    expect(MeasurementBatchV1Schema.safeParse(batch).success).toBe(true)
  })

  it('binds an in-toto statement to the exact measurement batch digest', () => {
    const statement = {
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: 'metrora:measurement-batch:batch_01', digest: { sha256: SHA_A } }],
      predicateType: 'https://schemas.metrora.dev/attestations/usage-evidence/v1',
      predicate: {
        kind: 'metrora.usage-evidence',
        version: 1,
        evidenceId: 'evidence_01',
        createdAt: NOW,
        workspaceId: 'workspace_01',
        endpointId: 'endpoint_01',
        producer: { name: 'metrora', version: '0.1.0' },
        measurementBatch: { batchId: 'batch_01', sha256: SHA_A },
        canonicalization: 'RFC8785',
        contentPolicy: {
          promptsIncluded: false,
          responsesIncluded: false,
          sourceCodeIncluded: false,
          patchesIncluded: false,
          secretsIncluded: false,
          localPathsIncluded: false,
        },
        materials: [{
          name: 'measurement-batch',
          kind: 'measurement-batch',
          digest: { sha256: SHA_A },
          mediaType: 'application/json',
        }],
        claims: [{
          claimId: 'claim_01',
          type: 'aggregate-usage',
          period: { from: NOW, to: LATER },
          dimensions: { repositoryId: 'repository_01' },
          totals: {
            calls: 1,
            sessions: 1,
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 40,
            cacheWriteTokens: 0,
            reasoningTokens: 5,
            costMicrosUsd: 1200,
          },
          assurance: {
            sourceCoverage: 'complete',
            tokenCounts: 'measured',
            pricing: 'estimated',
          },
        }],
      },
    }

    expect(parseUsageEvidenceStatementV1(statement)).toEqual(statement)
    expect(() => parseUsageEvidenceStatementV1({
      ...statement,
      subject: [{ name: 'metrora:measurement-batch:batch_01', digest: { sha256: SHA_B } }],
    })).toThrow(/bind the declared measurement batch digest/)
  })
})
