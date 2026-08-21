export function getRawPayloadFieldWindow(source: Buffer, field: string, windowBytes = 4096): string | undefined {
  const payloadKey = Buffer.from('"payload"')
  const payloadIndex = source.indexOf(payloadKey)
  if (payloadIndex < 0) return undefined
  let payloadStart = source.indexOf(0x7b, payloadIndex + payloadKey.length) // {
  if (payloadStart < 0) return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = payloadStart; i < source.length; i++) {
    const byte = source[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (byte === 0x5c) escaped = true // \\
      else if (byte === 0x22) inString = false // "
      continue
    }
    if (byte === 0x22) {
      const keyStart = i + 1
      let keyEnd = keyStart
      let keyEscaped = false
      for (; keyEnd < source.length; keyEnd++) {
        const keyByte = source[keyEnd]!
        if (keyEscaped) { keyEscaped = false; continue }
        if (keyByte === 0x5c) { keyEscaped = true; continue }
        if (keyByte === 0x22) break
      }
      if (depth === 1 && keyEnd < source.length) {
        const key = source.subarray(keyStart, keyEnd).toString('utf-8')
        let valueStart = keyEnd + 1
        while (valueStart < source.length && (source[valueStart] === 0x20 || source[valueStart] === 0x09 || source[valueStart] === 0x0a || source[valueStart] === 0x0d)) valueStart++
        if (source[valueStart] === 0x3a && key === field) {
          return source.subarray(i, Math.min(source.length, i + windowBytes)).toString('utf-8')
        }
      }
      i = keyEnd
      inString = false
      continue
    }
    if (byte === 0x22) inString = true
    else if (byte === 0x7b || byte === 0x5b) depth++ // { or [
    else if (byte === 0x7d || byte === 0x5d) depth-- // } or ]
    if (depth < 0) break
  }
  return undefined
}

export function getRawDirectPayloadStringField(source: Buffer, field: string): string | undefined {
  const window = getRawPayloadFieldWindow(source, field)
  if (!window) return undefined

  const colon = window.indexOf(':')
  if (colon < 0) return undefined
  let valueStart = colon + 1
  while (valueStart < window.length && /\s/.test(window[valueStart]!)) valueStart++
  if (window[valueStart] !== '"') return undefined

  let valueEnd = -1
  let escaped = false
  for (let i = valueStart + 1; i < window.length; i++) {
    const character = window[i]!
    if (escaped) escaped = false
    else if (character === '\\') escaped = true
    else if (character === '"') {
      valueEnd = i
      break
    }
  }
  if (valueEnd < 0) return undefined

  let afterValue = valueEnd + 1
  while (afterValue < window.length && /\s/.test(window[afterValue]!)) afterValue++
  if (afterValue >= window.length || !',}'.includes(window[afterValue]!)) return undefined

  try {
    const value: unknown = JSON.parse(window.slice(valueStart, valueEnd + 1))
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}
