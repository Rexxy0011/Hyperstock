import { pct, isUp } from '../../lib/format';

/**
 * Ported from the design system's components/market/PriceChange.jsx.
 *
 * The SOLE owner of the signed-percentage convention. Every green/red delta in
 * the product renders through here, so the U+2212 minus and the arrow geometry
 * are defined once. The arrow is drawn at (size - 3) square, matching the
 * source component.
 */
/**
 * `onDark` swaps the loss red for its deep-surface counterpart. It stays a prop
 * here rather than becoming a second component because this is the sole owner
 * of the signed-percentage convention, and a fork would be a second owner.
 */
export default function PriceChange({
  value,
  size = 13,
  pill = false,
  onDark = false,
  className = '',
}) {
  const up = isUp(value);
  const glyph = size - 3;

  return (
    <span
      className={[
        'inline-flex items-center gap-1 font-numeric font-medium tabular-nums',
        up ? 'text-gain' : onDark ? 'text-loss-deep' : 'text-loss',
        pill ? `rounded-md px-2 py-0.5 ${up ? 'bg-green-tint' : 'bg-red-tint'}` : '',
        className,
      ].join(' ')}
      style={{ fontSize: size }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 12 12"
        className="shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={up ? 'M2 10 L10 2 M10 2 H4.5 M10 2 V7.5' : 'M2 2 L10 10 M10 10 H4.5 M10 10 V4.5'}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {pct(value)}
    </span>
  );
}
