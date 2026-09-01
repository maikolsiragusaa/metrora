import type { ReactNode } from 'react'

/** The single renderer frame. Navigation and product state remain outside this shell. */
export function MetroraShell({
  sidebar,
  children,
  className,
}: {
  sidebar: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={['metrora-shell', className].filter(Boolean).join(' ')} data-metrora-shell="true">
      {sidebar}
      <main className="metrora-shell__main">{children}</main>
    </div>
  )
}
