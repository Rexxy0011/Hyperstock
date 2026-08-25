import { useMemo, useRef, useState } from 'react';
import { money } from '../../lib/format';

/**
 * The dashboard's main price chart: soft gradient fill, dashed grid, and a
 * crosshair that snaps to the nearest point with a dark tooltip.
 *
 * Hand-rolled rather than Recharts because the crosshair, the gradient stop and
 * the non-scaling 1.5px stroke are all easier to control directly than to
 * fight a library's defaults into matching the design.
 */
export default function AreaChart({ points = [], currency = 'USD', height = 260, className = '' }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const W = 800;
  const H = height;
  const PAD_Y = 18;

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((p) => p.cCents ?? p.valueCents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const coords = values.map((v, i) => ({
      x: (i / (values.length - 1)) * W,
      y: H - PAD_Y - ((v - min) / range) * (H - PAD_Y * 2),
      v,
      t: points[i].t,
    }));

    const line = coords.map((c) => `${c.x},${c.y}`).join(' ');
    const area = `${line} ${W},${H} 0,${H}`;
    const rising = values.at(-1) >= values[0];

    // Six evenly spaced ticks, always including both endpoints.
    const TICKS = 6;
    const ticks = Array.from({ length: TICKS }, (_, i) => {
      const idx = Math.round((i / (TICKS - 1)) * (coords.length - 1));
      return { pct: (idx / (coords.length - 1)) * 100, t: coords[idx].t };
    });

    return { coords, line, area, rising, min, max, ticks };
  }, [points, H]);

  if (!geometry) {
    return <div style={{ height }} className={`animate-pulse rounded-xl bg-hover ${className}`} />;
  }

  const { coords, line, area, rising, ticks } = geometry;

  // Intraday ranges are hours, everything longer is days.
  const spanMs = coords.at(-1).t - coords[0].t;
  const tickLabel = (t) =>
    new Date(t).toLocaleString('en-US',
      spanMs <= 36 * 3_600_000
        ? { hour: '2-digit', minute: '2-digit', hour12: false }
        : { day: 'numeric', month: 'short' });
  const color = rising ? 'var(--color-gain)' : 'var(--color-loss)';
  const gradientId = rising ? 'areaUp' : 'areaDown';

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (coords.length - 1));
    setHover(coords[Math.max(0, Math.min(coords.length - 1, index))]);
  };

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="block w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Price history"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={`h${f}`}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="var(--color-cool-grey)"
            strokeWidth="1"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {ticks.slice(1, -1).map((tick) => (
          <line
            key={`v${tick.pct}`}
            x1={(tick.pct / 100) * W}
            x2={(tick.pct / 100) * W}
            y1="0"
            y2={H}
            stroke="var(--color-cool-grey)"
            strokeWidth="1"
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {hover && (
          <>
            <line
              x1={hover.x}
              x2={hover.x}
              y1="0"
              y2={H}
              stroke="var(--color-slate)"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={hover.x} cy={hover.y} r="4" fill={color} stroke="white" strokeWidth="2"
              vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      <div className="relative mt-2 h-4">
        {ticks.map((tick) => (
          <span
            key={tick.pct}
            className="absolute -translate-x-1/2 font-numeric text-2xs whitespace-nowrap text-text-muted tabular-nums"
            style={{
              left: `${tick.pct}%`,
              // Pin the endpoints inside the box instead of letting them hang off.
              transform:
                tick.pct === 0 ? 'none' : tick.pct === 100 ? 'translateX(-100%)' : undefined,
            }}
          >
            {tickLabel(tick.t)}
          </span>
        ))}
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 whitespace-nowrap shadow-panel"
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * height - 10}px` }}
        >
          <div className="font-numeric text-2xs font-semibold tabular-nums text-white">
            {money(hover.v, currency)}
          </div>
          <div className="text-2xs text-text-on-deep-muted">
            {new Date(hover.t).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
          </div>
        </div>
      )}
    </div>
  );
}
