import mark from '../../../assets/brand/metrora-mark.svg'
import inverseMark from '../../../assets/brand/metrora-mark-inverse.svg'

/** Canonical Signal Grid mark; CSS chooses the approved light/dark asset. */
export function MetroraMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={['metrora-mark', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    >
      <img className="metrora-mark-light" src={mark} alt="" />
      <img className="metrora-mark-inverse" src={inverseMark} alt="" />
    </span>
  )
}
