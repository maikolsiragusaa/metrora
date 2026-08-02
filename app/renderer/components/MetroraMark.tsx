export function MetroraMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={['metrora-mark', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 180 152"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="8" y="8" width="14" height="104" rx="2" />
      <rect x="38" y="40" width="14" height="88" rx="2" />
      <rect x="68" y="68" width="14" height="76" rx="2" />
      <rect x="98" y="68" width="14" height="76" rx="2" />
      <rect x="128" y="40" width="14" height="88" rx="2" />
      <rect x="158" y="8" width="14" height="104" rx="2" />
    </svg>
  )
}
