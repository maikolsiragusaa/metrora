import type { ReactNode } from 'react'

export type HintItem = { k?: string; label: ReactNode }

function Keycaps({ value }: { value: string }) {
  // Keep the established 1–8 navigation range readable while exposing the new
  // Workspace shortcut as its own keycap instead of hiding it in a dense range.
  if (value === '⌘1-9') {
    return (
      <>
        <span className="k">⌘1-8</span>
        <span className="k">⌘9</span>
      </>
    )
  }
  return <span className="k">{value}</span>
}

/** The `.hint` footer strip: keycap hints on the left, optional right-aligned note. */
export function Hint({ items, right }: { items: HintItem[]; right?: ReactNode }) {
  return (
    <div className="hint">
      {items.map((item, i) => (
        <span key={i}>
          {item.k && <Keycaps value={item.k} />}
          {item.label}
        </span>
      ))}
      {right !== undefined && <span className="r">{right}</span>}
    </div>
  )
}
