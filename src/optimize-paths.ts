import { homedir, tmpdir } from 'os'

/** Keep temporary paths explicit while abbreviating ordinary paths below home. */
export function shortHomePath(absPath: string): string {
  const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedPath = normalize(absPath)
  const normalizedTemp = normalize(tmpdir())
  const normalizedHome = normalize(homedir())
  const compare = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const isUnder = (root: string): boolean => {
    const pathValue = compare(normalizedPath)
    const rootValue = compare(root)
    return pathValue === rootValue || pathValue.startsWith(`${rootValue}/`)
  }
  if (isUnder(normalizedTemp)) return absPath
  return isUnder(normalizedHome) ? '~' + absPath.slice(homedir().length) : absPath
}
