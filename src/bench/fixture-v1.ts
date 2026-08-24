import { sha256Json } from './serialization.js'

export const SYNTHETIC_FIXTURE_PACK = {
  packId: 'metrora.benchrun.synthetic.v1',
  version: '1.0.0',
  caseId: 'bounded-single-turn',
  prompt: [
    'This is a synthetic Metrora BenchRun V1 workload.',
    'Return one short neutral sentence confirming that the bounded fixture was received.',
    'Do not discuss model quality, ranking, pricing, or real user work.',
  ].join(' '),
} as const

export const SYNTHETIC_FIXTURE_DIGEST = sha256Json(SYNTHETIC_FIXTURE_PACK)
