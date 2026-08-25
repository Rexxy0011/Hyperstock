/**
 * A deterministic avatar generated from a username.
 *
 * Every trader gets a distinct mark with no image data anywhere in the system:
 * the same name always produces the same artwork, so a signup gets one for free
 * and nothing has to be seeded, uploaded or fetched. It is inline SVG, so it
 * costs no request and cannot trip the artifact CSP.
 *
 * Deliberately abstract rather than a face. These are simulated traders with
 * invented track records, and attaching a real person's likeness to an invented
 * return would be misrepresentation however the photo was sourced.
 *
 * Saturation and lightness are pinned to a narrow band. The hue is free to roam
 * so rows stay tellable apart, but the palette elsewhere in this product is
 * restrained, and fully saturated avatars would fight the gain/loss colours
 * that carry actual meaning in the same row.
 */

/** FNV-1a. Small, fast, and stable across runs — Math.random would defeat the point. */
function hashName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export default function Avatar({ name = '', src = undefined, size = 40, className = '' }) {
  // A supplied portrait wins; the generated mark is the fallback, so a roster
  // can be part photo and part generated without the rows looking mismatched.
  // object-cover crops to the square rather than squashing the face.
  if (src) {
    return (
      <img
        src={src}
        alt={`${name} avatar`}
        width={size}
        height={size}
        loading="lazy"
        className={`shrink-0 rounded-lg object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const h = hashName(name || '?');

  const hue = h % 360;
  const hueB = (hue + 24 + ((h >>> 9) % 54)) % 360;

  // Shape placement, all drawn from disjoint slices of the same hash.
  const cx = 26 + ((h >>> 3) % 46);
  const cy = 22 + ((h >>> 6) % 46);
  const r = 26 + ((h >>> 11) % 20);
  const bx = -10 + ((h >>> 15) % 46);
  const by = 44 + ((h >>> 19) % 40);
  const rot = (h >>> 23) % 90;

  const id = `av${h.toString(36)}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 rounded-lg ${className}`}
      role="img"
      aria-label={`${name} avatar`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 46% 58%)`} />
          <stop offset="100%" stopColor={`hsl(${hueB} 44% 40%)`} />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <rect width="100" height="100" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}c)`}>
        <rect width="100" height="100" fill={`url(#${id})`} />
        <circle cx={cx} cy={cy} r={r} fill="#fff" opacity="0.2" />
        <rect
          x={bx}
          y={by}
          width="64"
          height="64"
          rx="12"
          fill="#fff"
          opacity="0.14"
          transform={`rotate(${rot} ${bx + 32} ${by + 32})`}
        />
      </g>
    </svg>
  );
}
