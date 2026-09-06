import { OpenCodeHost } from '../components/OpenCodeHost'

/** Code keeps the execution surface in the upstream OpenCode WebContentsView host. */
export function Code() {
  return (
    <section className="code-section" aria-label="Code">
      <div className="code-section__header">
        <div><span className="eyebrow">Code</span><strong>OpenCode workspace</strong></div>
        <span>Powered by upstream OpenCode</span>
      </div>
      <OpenCodeHost />
    </section>
  )
}
