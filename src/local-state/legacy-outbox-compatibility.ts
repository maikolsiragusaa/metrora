import {
  USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  USAGE_MEASUREMENT_EVENT_TYPE,
  UsageMeasurementEventV1Schema,
  type UsageMeasurementEventV1,
} from '../contracts/v1/measurement.js'
import {
  LEGACY_LOCAL_OUTBOX_RECORD_KIND,
  LEGACY_OUTBOX_CANONICALIZATION,
  LEGACY_OUTBOX_EVENT_FILE_PREFIX,
  LEGACY_OUTBOX_EVENT_SOURCE_PREFIX,
  LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  LEGACY_USAGE_MEASUREMENT_EVENT_TYPE,
} from './legacy-identity-compatibility.js'

export type CurrentParseResult =
  | { success: true; data: unknown }
  | { success: false; error: unknown }

export type StoredOutboxRecordCompatibility = {
  record: unknown
  legacy: boolean
  eventFile: string
  rawEvent: unknown
}

export function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function hasLegacyRecordMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const event = record.event
  if (record.kind === LEGACY_LOCAL_OUTBOX_RECORD_KIND || record.canonicalization === LEGACY_OUTBOX_CANONICALIZATION) {
    return true
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return false
  const eventValue = event as Record<string, unknown>
  return eventValue.type === LEGACY_USAGE_MEASUREMENT_EVENT_TYPE
    || eventValue.dataschema === LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI
}

export function normalizeLegacyMeasurementEventV1(value: unknown): UsageMeasurementEventV1 {
  const event = objectValue(value, 'legacy outbox event shape is invalid')
  const data = objectValue(event.data, 'legacy outbox event data is invalid')
  const endpointId = data.endpointId
  if (typeof endpointId !== 'string') throw new Error('legacy outbox event endpoint binding is invalid')
  if (
    event.type !== LEGACY_USAGE_MEASUREMENT_EVENT_TYPE
    || event.dataschema !== LEGACY_USAGE_MEASUREMENT_DATA_SCHEMA_URI
    || event.source !== `${LEGACY_OUTBOX_EVENT_SOURCE_PREFIX}${endpointId}`
  ) {
    throw new Error('legacy outbox event namespace is not the exact historical form')
  }
  return UsageMeasurementEventV1Schema.parse({
    ...event,
    source: `urn:metrora:endpoint:${endpointId}`,
    type: USAGE_MEASUREMENT_EVENT_TYPE,
    dataschema: USAGE_MEASUREMENT_DATA_SCHEMA_URI,
  })
}

function normalizeLegacyRecord(
  value: unknown,
  parseNormalized: (value: unknown) => CurrentParseResult,
): unknown {
  const record = objectValue(value, 'legacy outbox record shape is invalid')
  if (record.kind !== LEGACY_LOCAL_OUTBOX_RECORD_KIND || record.canonicalization !== LEGACY_OUTBOX_CANONICALIZATION) {
    throw new Error('legacy outbox record namespace is not the exact historical form')
  }
  const normalized = parseNormalized({
    ...record,
    kind: 'metrora.local-measurement-outbox-record',
    canonicalization: 'metrora-sorted-json-v1',
    event: normalizeLegacyMeasurementEventV1(record.event),
  })
  if (!normalized.success) throw normalized.error
  return normalized.data
}

export function legacyEventFileName(eventId: string, digest: (value: string) => string): string {
  return `${digest(`${LEGACY_OUTBOX_EVENT_FILE_PREFIX}${eventId}`)}.json`
}

export function parseStoredOutboxRecord(
  value: unknown,
  expectedFile: string | undefined,
  current: CurrentParseResult,
  parseNormalized: (value: unknown) => CurrentParseResult,
  eventDigest: (event: unknown) => string,
  currentEventFileName: (eventId: string) => string,
  digest: (value: string) => string,
): StoredOutboxRecordCompatibility {
  if (current.success) {
    const record = objectValue(current.data, 'current outbox record is invalid')
    const event = objectValue(record.event, 'current outbox event is invalid')
    const eventId = event.id
    if (typeof eventId !== 'string') throw new Error('current outbox event id is invalid')
    if (record.eventSha256 !== eventDigest(event)) {
      throw new Error('event digest does not match its canonical payload')
    }
    if (expectedFile && currentEventFileName(eventId) !== expectedFile) {
      throw new Error('event id does not match its outbox filename')
    }
    return {
      record: current.data,
      legacy: false,
      eventFile: expectedFile ?? currentEventFileName(eventId),
      rawEvent: event,
    }
  }

  if (!hasLegacyRecordMarker(value)) throw current.error
  const raw = objectValue(value, 'legacy outbox record shape is invalid')
  const rawEvent = raw.event
  if (raw.eventSha256 !== eventDigest(rawEvent)) {
    throw new Error('legacy outbox event digest does not match its historical canonical payload')
  }
  const rawEventValue = objectValue(rawEvent, 'legacy outbox event shape is invalid')
  const eventId = rawEventValue.id
  if (typeof eventId !== 'string') throw new Error('legacy outbox event id is invalid')
  if (expectedFile && legacyEventFileName(eventId, digest) !== expectedFile) {
    throw new Error('legacy event id does not match its historical outbox filename')
  }
  const record = normalizeLegacyRecord(value, parseNormalized)
  return {
    record,
    legacy: true,
    eventFile: expectedFile ?? legacyEventFileName(eventId, digest),
    rawEvent,
  }
}
