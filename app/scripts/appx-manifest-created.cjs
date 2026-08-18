const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { DOMParser } = require('@xmldom/xmldom')

const FOUNDATION_NAMESPACE = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10'
const EXPECTED_IDENTITY_NAME = 'Vensent.Metrora'
const EXPECTED_PUBLISHER = 'CN=BC955F81-5099-4C27-A7A6-FF611BAACC3F'
const EXPECTED_ARCHITECTURE = 'x64'
const AUTHORITY_PATH = resolve(__dirname, '..', '..', 'release', 'windows-store-package-version.v1.json')
const VERSION_AUTHORITY_MODULE = pathToFileURL(resolve(__dirname, '..', '..', 'scripts', 'version-authority-lib.mjs')).href

function parseManifest(xml) {
  const errors = []
  const document = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: message => errors.push(String(message)),
      fatalError: message => errors.push(String(message)),
    },
  }).parseFromString(xml, 'application/xml')

  if (errors.length > 0 || !document?.documentElement) {
    throw new Error('AppX manifest XML is malformed')
  }
  if (
    document.documentElement.localName !== 'Package' ||
    document.documentElement.namespaceURI !== FOUNDATION_NAMESPACE
  ) {
    throw new Error('AppX manifest root must be the Windows foundation Package element')
  }
  return document
}

function getIdentity(document) {
  const identities = []
  for (let child = document.documentElement.firstChild; child; child = child.nextSibling) {
    if (
      child.nodeType === 1 &&
      child.localName === 'Identity' &&
      child.namespaceURI === FOUNDATION_NAMESPACE
    ) identities.push(child)
  }
  if (identities.length !== 1 || document.getElementsByTagNameNS(FOUNDATION_NAMESPACE, 'Identity').length !== 1) {
    throw new Error('AppX manifest must contain exactly one direct Package/Identity element')
  }

  const identity = identities[0]
  for (const [attribute, expected] of [
    ['Name', EXPECTED_IDENTITY_NAME],
    ['Publisher', EXPECTED_PUBLISHER],
    ['ProcessorArchitecture', EXPECTED_ARCHITECTURE],
  ]) {
    if (identity.getAttribute(attribute) !== expected) {
      throw new Error(`AppX manifest Identity ${attribute} is not the reviewed Store value`)
    }
  }
  const currentVersion = identity.getAttribute('Version')
  if (!currentVersion) throw new Error('AppX manifest Identity Version is missing')
  return { identity, currentVersion }
}

function replaceIdentityVersion(xml, currentVersion, candidateVersion) {
  // The XML DOM above proves this is the one structural Identity element. The
  // bounded text match below preserves every unrelated byte in the generated
  // manifest and can only replace the exact Version attribute on that element.
  const identityTags = [...xml.matchAll(/<(?:(?:[A-Za-z_][\w.-]*):)?Identity\b[^>]*\/?>/g)]
  if (identityTags.length !== 1) throw new Error('AppX manifest Identity text shape is ambiguous')

  const identityTag = identityTags[0][0]
  const versionAttributes = [...identityTag.matchAll(/\bVersion\s*=\s*(['"])([^'"]*)\1/g)]
  if (versionAttributes.length !== 1 || versionAttributes[0][2] !== currentVersion) {
    throw new Error('AppX manifest Identity Version attribute shape is ambiguous')
  }

  const versionAttribute = versionAttributes[0]
  const quoteOffset = versionAttribute[0].indexOf(versionAttribute[1])
  const valueStart = identityTags[0].index + versionAttribute.index + quoteOffset + 1
  return `${xml.slice(0, valueStart)}${candidateVersion}${xml.slice(valueStart + currentVersion.length)}`
}

function applyStorePackageVersion(xml, authority) {
  if (typeof xml !== 'string') throw new Error('AppX manifest XML must be a string')
  if (
    !authority ||
    typeof authority.publishedStorePackageVersion !== 'string' ||
    typeof authority.candidateStorePackageVersion !== 'string'
  ) {
    throw new Error('Store package version authority is incomplete')
  }

  const document = parseManifest(xml)
  const { currentVersion } = getIdentity(document)
  if (currentVersion !== authority.publishedStorePackageVersion) {
    throw new Error(
      `generated AppX identity version must equal the published Store baseline ${authority.publishedStorePackageVersion}`,
    )
  }
  if (authority.candidateStorePackageVersion === authority.publishedStorePackageVersion) {
    throw new Error('candidate Store package version must differ from the published baseline')
  }
  return replaceIdentityVersion(xml, currentVersion, authority.candidateStorePackageVersion)
}

async function loadStorePackageVersionAuthority() {
  const { validateStorePackageVersionAuthority } = await import(VERSION_AUTHORITY_MODULE)
  return validateStorePackageVersionAuthority(JSON.parse(readFileSync(AUTHORITY_PATH, 'utf8')))
}

async function appxManifestCreated(manifestPath) {
  if (typeof manifestPath !== 'string' || !manifestPath) {
    throw new Error('appxManifestCreated requires the generated AppxManifest.xml path')
  }
  const authority = await loadStorePackageVersionAuthority()
  const original = readFileSync(manifestPath, 'utf8')
  const transformed = applyStorePackageVersion(original, authority)
  writeFileSync(manifestPath, transformed, 'utf8')
}

exports.default = appxManifestCreated
exports.applyStorePackageVersion = applyStorePackageVersion
