/**
 * Zanban brand mark — geometric phase/listen vocabulary.
 *
 * Six variants are kept available so the mark can be tuned per surface
 * (overlay status pill, dashboard header, splash, app icon). `phase-dot`
 * is the canonical default — half-disk with an offset signal slot.
 *
 * The `signal` prop swaps the signal-coloured detail (used in active /
 * recording states); leave it undefined for the calm/idle rendering.
 */

export type ZanbanMarkVariant =
  | 'phase-dot'
  | 'half-disk'
  | 'arc'
  | 'wedge'
  | 'sonar'
  | 'split'

export interface ZanbanMarkProps {
  variant?: ZanbanMarkVariant
  size?: number
  /** When set, fills the signal-coloured detail (recording / pending). */
  signal?: string
  /** Foreground colour for the rest of the mark. Defaults to currentColor. */
  fg?: string
  className?: string
  'aria-label'?: string
}

export function ZanbanMark({
  variant = 'phase-dot',
  size = 16,
  signal,
  fg = 'currentColor',
  className,
  'aria-label': ariaLabel
}: ZanbanMarkProps): React.JSX.Element {
  const props = { size, signal, fg, className, ariaLabel }
  switch (variant) {
    case 'half-disk':
      return <MarkHalfDisk {...props} />
    case 'arc':
      return <MarkArc {...props} />
    case 'wedge':
      return <MarkWedge {...props} />
    case 'sonar':
      return <MarkSonar {...props} />
    case 'split':
      return <MarkSplit {...props} />
    case 'phase-dot':
    default:
      return <MarkPhaseDot {...props} />
  }
}

interface InnerProps {
  size: number
  signal?: string
  fg: string
  className?: string
  ariaLabel?: string
}

function svgProps(s: number, className?: string, ariaLabel?: string) {
  return {
    width: s,
    height: s,
    viewBox: `0 0 ${s} ${s}`,
    fill: 'none',
    className,
    role: ariaLabel ? 'img' : undefined,
    'aria-label': ariaLabel,
    'aria-hidden': ariaLabel ? undefined : true
  } as const
}

function MarkHalfDisk({ size, signal, fg, className, ariaLabel }: InnerProps) {
  const c = size / 2
  const r = size * 0.4
  return (
    <svg {...svgProps(size, className, ariaLabel)}>
      <circle cx={c} cy={c} r={r} stroke={fg} strokeWidth={size * 0.045} opacity={0.35} />
      <path d={`M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r} Z`} fill={signal || fg} />
    </svg>
  )
}

function MarkArc({ size, signal, fg, className, ariaLabel }: InnerProps) {
  const c = size / 2
  const sw = size * 0.06
  return (
    <svg {...svgProps(size, className, ariaLabel)}>
      <circle cx={c} cy={c} r={size * 0.06} fill={signal || fg} />
      <path
        d={`M ${c - size * 0.22} ${c - size * 0.22} A ${size * 0.31} ${size * 0.31} 0 0 1 ${c + size * 0.22} ${c - size * 0.22}`}
        stroke={fg}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d={`M ${c - size * 0.34} ${c - size * 0.34} A ${size * 0.48} ${size * 0.48} 0 0 1 ${c + size * 0.34} ${c - size * 0.34}`}
        stroke={fg}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.25}
      />
    </svg>
  )
}

function MarkPhaseDot({ size, signal, fg, className, ariaLabel }: InnerProps) {
  const c = size / 2
  const r = size * 0.36
  return (
    <svg {...svgProps(size, className, ariaLabel)}>
      <path
        d={`M ${c} ${c - r} A ${r} ${r} 0 0 0 ${c} ${c + r} Z`}
        fill={fg}
        opacity={0.85}
      />
      <circle cx={c + r * 0.55} cy={c} r={size * 0.075} fill={signal || fg} />
    </svg>
  )
}

function MarkWedge({ size, signal, fg, className, ariaLabel }: InnerProps) {
  const c = size / 2
  const r = size * 0.4
  const x2 = c + r
  const y2 = c
  const x1 = c
  const y1 = c - r
  const sw = size * 0.045
  return (
    <svg {...svgProps(size, className, ariaLabel)}>
      <circle cx={c} cy={c} r={r} stroke={fg} strokeWidth={sw} opacity={0.3} />
      <path
        d={`M ${c} ${c} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
        fill={signal || fg}
      />
    </svg>
  )
}

function MarkSonar({ size, signal, fg, className, ariaLabel }: InnerProps) {
  const c = size / 2
  const sw = size * 0.055
  const arc = (r: number, op: number, k: string) => (
    <path
      key={k}
      d={`M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r} ${c}`}
      stroke={fg}
      strokeWidth={sw}
      strokeLinecap="round"
      opacity={op}
      fill="none"
    />
  )
  return (
    <svg {...svgProps(size, className, ariaLabel)}>
      {arc(size * 0.4, 0.2, 'a')}
      {arc(size * 0.28, 0.45, 'b')}
      {arc(size * 0.16, 0.75, 'c')}
      <circle cx={c} cy={c + size * 0.04} r={size * 0.05} fill={signal || fg} />
    </svg>
  )
}

function MarkSplit({ size, signal, fg, className, ariaLabel }: InnerProps) {
  const c = size / 2
  const r = size * 0.34
  const sw = size * 0.1
  return (
    <svg {...svgProps(size, className, ariaLabel)}>
      <path
        d={`M ${c - r} ${c - size * 0.04} A ${r} ${r} 0 0 1 ${c + r} ${c - size * 0.04}`}
        stroke={fg}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.85}
      />
      <path
        d={`M ${c - r} ${c + size * 0.04} A ${r} ${r} 0 0 0 ${c + r} ${c + size * 0.04}`}
        stroke={signal || fg}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={signal ? 1 : 0.4}
      />
    </svg>
  )
}
