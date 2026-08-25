/**
 * Hand-rolled rather than a chart library: the Holdings table renders one of
 * these per row, and Recharts' ResponsiveContainer carries far too much weight
 * to instantiate dozens of times. Geometry matches the design system's
 * components/market/Sparkline.jsx exactly.
 */
export default function Sparkline({ data = [], width = 96, height = 28, color = undefined, className = '' }) {
  if (data.length < 2) return <svg width={width} height={height} className={className} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x},${y}`;
    })
    .join(' ');

  const stroke = color ?? (data.at(-1) >= data[0] ? 'var(--color-gain)' : 'var(--color-loss)');

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
