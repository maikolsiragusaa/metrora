const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/
const STORE_PACKAGE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const MAX_WINDOWS_COMPONENT = 65_535
const STABLE_BUILD_COMPONENT = 10_000
const MAX_RC_COMPONENT = STABLE_BUILD_COMPONENT - 1
export const STORE_PACKAGE_VERSION_AUTHORITY_PATH = 'release/windows-store-package-version.v1.json'

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

export function parseStorePackageVersion(version) {
  if (typeof version !== 'string') throw new Error('Store package version must be a string')
  const match = STORE_PACKAGE_VERSION_PATTERN.exec(version)
  if (!match) {
    throw new Error(`unsupported Store package version ${version}; expected four numeric components without leading zeroes`)
  }

  const major = parseComponent(match[1], 'Store package major version')
  const minor = parseComponent(match[2], 'Store package minor version')
  const patch = parseComponent(match[3], 'Store package patch version')
  const revision = parseComponent(match[4], 'Store package revision')
  if (revision !== 0) throw new Error('Store package revision must be 0 for the Windows Store contract')

  return { version, major, minor, patch, revision }
}

export function compareStorePackageVersions(leftVersion, rightVersion) {
  const left = parseStorePackageVersion(leftVersion)
  const right = parseStorePackageVersion(rightVersion)

  for (const key of ['major', 'minor', 'patch', 'revision']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return 0
}

export function validateStorePackageVersionAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    throw new Error('Store package version authority must be an object')
  }

  const actualKeys = Object.keys(authority).sort()
  const expectedKeys = ['candidateStorePackageVersion', 'publishedStorePackageVersion', 'schemaVersion']
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('Store package version authority fields are invalid')
  }
  if (authority.schemaVersion !== 1) {
    throw new Error('Store package version authority schemaVersion must be 1')
  }

  const publishedStorePackageVersion = parseStorePackageVersion(authority.publishedStorePackageVersion)
  const candidateStorePackageVersion = parseStorePackageVersion(authority.candidateStorePackageVersion)
  if (compareStorePackageVersions(candidateStorePackageVersion.version, publishedStorePackageVersion.version) <= 0) {
    throw new Error('candidate Store package version must be greater than the published baseline')
  }

  return Object.freeze({
    schemaVersion: 1,
    publishedStorePackageVersion: publishedStorePackageVersion.version,
    candidateStorePackageVersion: candidateStorePackageVersion.version,
  })
}
