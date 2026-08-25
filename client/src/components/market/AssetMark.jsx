import { useState } from 'react';
import { monogram } from '../../lib/monogram';

/**
 * The brand mark for an instrument, on every surface that shows one.
 *
 * IT EXISTS BECAUSE THERE WERE THREE OF IT AND THEY DISAGREED. `Markets`,
 * `Instrument` and `InstrumentSidebar` each had a private `Mark`, and Portfolio
 * had none at all — its holdings table, position cards, position header and
 * watchlist called `monogram()` directly, so the one screen a signed-in user
 * spends the most time on rendered grey initials for companies whose logos were
 * already loading two screens over. The sidebar's copy had no `onError` either,
 * so a dead URL there left a broken image rather than falling back.
 *
 * The fallback is the point, not an edge case. Logo coverage is 30 of 34 seeded
 * symbols and the URL is built from the ticker rather than supplied by a
 * vendor, so a miss is expected and must look deliberate: `Mark` degrades to
 * the monogram on the image's own error event, which also catches a host that
 * starts 403ing later without anything here needing to know.
 *
 * `monogram()` rather than `symbol.slice(0, 2)` — the design system's version
 * turns 600519, 601398 and 601899 into three identical "60" avatars.
 *
 * @param {{ symbol: string, name?: string, logoUrl?: string, size?: number,
 *   radius?: string, tone?: 'ink' | 'mist' | 'deep' }} props
 */
export default function AssetMark({
  symbol,
  name = '',
  logoUrl = '',
  size = 28,
  radius = 'rounded-lg',
  tone = 'ink',
}) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        // Tinted, because `loading="lazy"` means the box exists before the
        // bytes do — untinted it is a void the size of the mark. The tint
        // follows the SURFACE, not the fallback chip: a flat `bg-mist` is
        // invisible on the light pages and a light flash on the terminal's ink
        // panel, and `bg-ink` would be the same mistake the other way round.
        className={`shrink-0 object-contain ${radius} ${
          tone === 'deep' ? 'bg-white/10' : 'bg-mist'
        }`}
      />
    );
  }

  return (
    <span
      style={{ width: size, height: size, fontSize: size <= 24 ? 9 : 11 }}
      className={[
        'inline-flex shrink-0 items-center justify-center font-mono font-bold',
        radius,
        TONES[tone],
      ].join(' ')}
      aria-hidden="true"
    >
      {monogram(symbol, name)}
    </span>
  );
}

/**
 * `deep` is the instrument terminal's ink panel, where a solid ink chip would
 * vanish into the surface it sits on and `bg-mist` would be a white slab.
 */
const TONES = {
  ink: 'bg-ink text-white',
  mist: 'bg-mist text-void',
  deep: 'bg-white/10 text-text-on-deep',
};
