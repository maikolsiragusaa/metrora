/*
 * Adapted from OpenHands/OpenHands
 * Original path: src/ui/typography.tsx
 * Exact source: 1a34e0222ee9e3c1f8c13fc16d28e69361a022ff
 * Licence: MIT; see LICENSES/OPENHANDS-MIT.txt
 * Metrora modification: replaced CVA/Tailwind variants with a small typed
 * class contract and Metrora's type ladder, while retaining the useful
 * variant-to-element convenience API.
 */

import type { ElementType, ReactNode } from 'react'

export type MetroraTypographyVariant = 'display' | 'title' | 'subtitle' | 'body' | 'label' | 'code'

const DEFAULT_TAG: Record<MetroraTypographyVariant, ElementType> = {
  display: 'h1',
  title: 'h2',
  subtitle: 'h3',
  body: 'p',
  label: 'span',
  code: 'code',
}

export function Typography({
  variant = 'body',
  as,
  className,
  testId,
  id,
  role,
  children,
}: {
  variant?: MetroraTypographyVariant
  as?: ElementType
  className?: string
  testId?: string
  id?: string
  role?: string
  children: ReactNode
}) {
  const Tag = as ?? DEFAULT_TAG[variant]
  return (
    <Tag id={id} role={role} data-testid={testId} className={['metrora-type', `metrora-type--${variant}`, className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  )
}

export function H1(props: Omit<Parameters<typeof Typography>[0], 'variant'>) {
  return <Typography {...props} variant="display" />
}

export function H2(props: Omit<Parameters<typeof Typography>[0], 'variant'>) {
  return <Typography {...props} variant="title" />
}

export function H3(props: Omit<Parameters<typeof Typography>[0], 'variant'>) {
  return <Typography {...props} variant="subtitle" />
}

export function Paragraph(props: Omit<Parameters<typeof Typography>[0], 'variant'>) {
  return <Typography {...props} variant="body" />
}

export function Text(props: Omit<Parameters<typeof Typography>[0], 'variant'>) {
  return <Typography {...props} variant="label" />
}

export function CodeBlock(props: Omit<Parameters<typeof Typography>[0], 'variant'>) {
  return <Typography {...props} variant="code" as="pre" />
}
