export function QovrionMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="11.5" cy="11.5" r="7.25" stroke="currentColor" strokeWidth="2.1" />
      <path d="M15.8 15.8 20 20" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M15.9 6.4c1.2 1.25 1.9 2.9 1.9 4.7" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  )
}
