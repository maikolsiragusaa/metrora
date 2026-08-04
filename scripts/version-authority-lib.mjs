const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/
const MAX_WINDOWS_COMPONENT = 65_535
const STABLE_BUILD_COMPONENT = 10_000
const MAX_RC_COMPONENT = STABLE_BUILD_COMPONENT - 1

function parseComponent(raw, label, max = MAX_WINDOWS_COMPONENT) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer between 0 and ${max}`)
  }
  return value
}

export function parseMetroraVersion(version) {
  if (typeof version !== 'string') throw new Error('version must be a string')
  const match = VERSION_PATTERN.exec(version)
  if (!match) throw new Error(`unsupported version ${version}; expected x.y.z or x.y.z-rc.N without leading zeroes`)

  const major = parseComponent(match[1], 'major version')
  const minor = parseComponent(match[2], 'minor version')
  const patch = parseComponent(match[3], 'patch version')
  const rc = match[4] === undefined ? null : parseComponent(match[4], 'release candidate', MAX_RC_COMPONENT)
  if (rc === 0) throw new Error('release candidate must be between 1 and 9999')

  return { version, major, minor, patch, rc }
}

export function compareMetroraVersions(leftVersion, rightVersion) {
  const left = parseMetroraVersion(leftVersion)
  const right = parseMetroraVersion(rightVersion)

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }

  if (left.rc === right.rc) return 0
  if (left.rc === null) return 1
  if (right.rc === null) return -1
  return left.rc < right.rc ? -1 : 1
}

export function buildVersionFor(version) {
  const parsed = parseMetroraVersion(version)
  const build = parsed.rc ?? STABLE_BUILD_COMPONENT
  return `${parsed.major}.${parsed.minor}.${parsed.patch}.${build}`
}
