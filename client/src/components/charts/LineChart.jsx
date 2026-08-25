/**
 * The dashed-gridline price chart used on Landing and Portfolio.
 *
 * Deliberately hand-rolled SVG rather than Recharts: the design specifies a
 * stroke of exactly 1.5px that must NOT scale when the chart stretches, which
 * `vector-effect: non-scaling-stroke` gives for free alongside
 * `preserveAspectRatio="none"`.
 */
export default function LineChart({
  data = [],
  width = 520,
  height = 180,
  gridLines = 3,
  color = undefined,
  className = '',
  ariaLabel = undefined,
}) {
  if (data.length < 2) {
    return <div style={{ height }} className={`w-full ${className}`} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 12;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const stroke = color ?? (data.at(-1) >= data[0] ? 'var(--color-gain)' : 'var(--color-loss)');
  const rows = Array.from({ length: gridLines }, (_, i) => ((i + 1) * height) / (gridLines + 1));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      height={height}
      className={`block w-full ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {rows.map((y) => (
        <line
          key={y}
          x1="0"
          x2={width}
          y1={y}
          y2={y}
          stroke="var(--color-cool-grey)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
      ))}
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
