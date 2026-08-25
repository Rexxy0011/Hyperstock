import { money } from '../../lib/format';

/**
 * Allocation donut. Segment lengths are computed from real percentages —
 * the source design's arcs disagreed with its own legend.
 */
const PALETTE = ['#0c1210', '#00c853', '#6b7280', '#9ca3af', '#c7cbd1', '#e5e7eb'];

export default function DonutChart({ slices = [], size = 132, thickness = 14 }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices.map((slice, i) => {
    const length = (slice.pct / 100) * circumference;
    const arc = {
      ...slice,
      color: PALETTE[i % PALETTE.length],
      dash: `${length} ${circumference - length}`,
      offset: -offset,
    };
    offset += length;
    return arc;
  });

  return (
    // Stacked, not side-by-side: this card lives in a ~340px column, and a
    // horizontal legend squeezed sector names down to a single character.
    <div className="flex flex-col items-center gap-5">
      <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden="true">
        {arcs.map((a) => (
          <circle
            key={a.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={a.color}
            strokeWidth={thickness}
            strokeDasharray={a.dash}
            strokeDashoffset={a.offset}
          />
        ))}
      </svg>

      <ul className="flex w-full flex-col gap-2.5">
        {arcs.map((a) => (
          <li key={a.label} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate text-text-muted">{a.label}</span>
            <span className="font-numeric text-text-muted tabular-nums">{money(a.valueCents)}</span>
            <span className="w-12 text-right font-numeric font-semibold tabular-nums text-void">
              {a.pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
