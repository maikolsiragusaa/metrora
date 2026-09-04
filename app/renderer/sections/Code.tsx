import { OpenCodeHost } from '../components/OpenCodeHost'

/** Code is deliberately only the upstream OpenCode WebContentsView host. */
export function Code() {
  return <section className="code-section" aria-label="Code"><OpenCodeHost /></section>
}
