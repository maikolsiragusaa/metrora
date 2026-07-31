import { readFileSync, writeFileSync } from 'node:fs'

const path = '.github/scripts/apply-qov-003.mjs'
let content = readFileSync(path, 'utf8')

function replaceExact(before, after) {
  const count = content.split(before).length - 1
  if (count !== 1) throw new Error(`expected one applicator fragment, found ${count}`)
  content = content.replace(before, after)
}

replaceExact(
`  [
    "    provider: call.provider,\\n    model: call.model,\\n    usage,\\n",
    "    provider: call.provider,\\n    model: call.model,\\n    ...(call.reasoningLevel ? {\\n      reasoningLevel: call.reasoningLevel,\\n      reasoningLevelSource: call.reasoningLevelSource,\\n    } : {}),\\n    usage,\\n",
  ],`,
`  [
    "  const apiCall: ParsedApiCall = applyLocalModelSavings({\\n    provider: call.provider,\\n    model: call.model,\\n    usage,\\n",
    "  const apiCall: ParsedApiCall = applyLocalModelSavings({\\n    provider: call.provider,\\n    model: call.model,\\n    ...(call.reasoningLevel ? {\\n      reasoningLevel: call.reasoningLevel,\\n      reasoningLevelSource: call.reasoningLevelSource,\\n    } : {}),\\n    usage,\\n",
  ],`,
)

replaceExact(
`  [
    "    provider: call.provider,\\n    model: call.model,\\n    usage: {\\n",
    "    provider: call.provider,\\n    model: call.model,\\n    ...(call.reasoningLevel ? {\\n      reasoningLevel: call.reasoningLevel,\\n      reasoningLevelSource: call.reasoningLevelSource,\\n    } : {}),\\n    usage: {\\n",
  ],`,
`  [
    "function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {\\n  return {\\n    provider: call.provider,\\n    model: call.model,\\n    usage: {\\n",
    "function providerCallToCachedCall(call: ParsedProviderCall): CachedCall {\\n  return {\\n    provider: call.provider,\\n    model: call.model,\\n    ...(call.reasoningLevel ? {\\n      reasoningLevel: call.reasoningLevel,\\n      reasoningLevelSource: call.reasoningLevelSource,\\n    } : {}),\\n    usage: {\\n",
  ],`,
)

writeFileSync(path, content)
