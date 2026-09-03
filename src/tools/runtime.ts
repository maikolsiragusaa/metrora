// Stable build entry for Electron's narrow DSH adapter. The adapter imports
// this compiled module so the canonical registry implementation remains one
// source of validation, evidence, privacy and envelope semantics.
export { METRORA_TOOL_CONTRACT, METRORA_TOOL_DEFINITIONS } from './contract.js'
export { createMetroraToolRegistry } from './registry.js'
