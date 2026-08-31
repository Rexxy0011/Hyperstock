import { money } from '../../lib/format';

/**
 * Allocation donut. Segment lengths are computed from real percentages —
 * the source design's arcs disagreed with its own legend.
 */
const PALETTE = ['#0c1210', '#00c853', '#6b7280', '#9ca3af', '#c7cbd1', '#e5e7eb'];

export default function DonutChart({ slices = [], size = 140, thickness = 16 }) {
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
    <div className="flex w-full flex-col sm:flex-row xl:flex-col items-start justify-start gap-6">
      <div className="relative shrink-0 flex items-center justify-start">
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
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
      </div>

      <ul className="flex w-full flex-1 flex-col gap-2.5 max-w-sm">
        {arcs.map((a) => (
          <li key={a.label} className="flex items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-2 flex-1">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
              <span className="truncate text-text font-medium">{a.label}</span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0 text-right">
              <span className="font-numeric text-text-muted tabular-nums">{money(a.valueCents)}</span>
              <span className="min-w-10 text-right font-numeric font-semibold tabular-nums text-void">
                {a.pct}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
