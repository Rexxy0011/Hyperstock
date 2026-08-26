import Icon from '../ui/Icon';
import { useTranslation } from 'react-i18next';
import Link from '../ui/Link';
import { useWatchlist } from '../../hooks/useWatchlist';

/**
 * Add to / remove from the watchlist, for any instrument in any asset class.
 *
 * TWO STATES, TWO DIFFERENT ACTIONS, and the icon says which. Off the list it
 * is a plus. On the list it rests as a green check — so a scan down the table
 * shows what is followed without reading anything — and swaps to a red minus on
 * hover or keyboard focus, because "already added" and "click to remove" are
 * different claims and a control that only ever showed the check would be
 * asserting the first while doing the second.
 *
 * The swap is CSS on `group-hover`/`group-focus-visible`, not React state:
 * forty of these render per table, and forty hover listeners re-rendering rows
 * on mouse movement is exactly the cost this page cannot pay.
 *
 * SIGNED OUT IT IS A LINK, not a disabled button. /markets renders for anonymous
 * visitors, and hiding the control would make the feature invisible to the
 * people most worth showing it to; a disabled one would be a dead end. It goes
 * to /auth instead, which is the actual next step.
 */
export default function WatchButton({
  row,
  assetClass,
  size = 32,
  onDark = false,
  className = '',
}) {
  const { t } = useTranslation();
  const { isWatched, add, remove, signedIn } = useWatchlist();

  // Same reasoning as Tabs: the resting border and text have to change together
  // for a deep surface, and `border-cool-grey` would win over anything passed
  // through className by stylesheet position.
  const idle = onDark
    ? 'border-white/20 text-text-on-deep-muted hover:border-gain hover:text-gain'
    : 'border-cool-grey text-text-muted hover:border-gain hover:text-gain';

  const cls = (extra) =>
    [
      'group relative inline-flex shrink-0 items-center justify-center rounded-lg border',
      'cursor-pointer no-underline transition-colors',
      extra,
      className,
    ].join(' ');
  const box = { width: size, height: size };
  const glyph = Math.round(size * 0.5);

  if (!signedIn) {
    return (
      <Link
        to="/auth?mode=signup"
        style={box}
        aria-label={`Sign in to add ${row.symbol} to your watchlist`}
        title={t('markets.signInWatchlist')}
        className={cls(idle)}
      >
        <Icon name="plus" size={glyph} />
      </Link>
    );
  }

  const watched = isWatched(assetClass, row.symbol);
  const payload = { assetClass, symbol: row.symbol, name: row.name };

  if (watched) {
    return (
      <button
        type="button"
        style={box}
        onClick={() => remove(payload)}
        aria-label={`Remove ${row.symbol} from watchlist`}
        title={t('common.removeFromWatchlist')}
        className={cls(
          'border-transparent bg-green-tint text-gain hover:bg-red-tint hover:text-loss focus-visible:bg-red-tint focus-visible:text-loss',
        )}
      >
        {/* Stacked rather than swapped by a condition, so the two glyphs cannot
            shift the button's width as they cross over. */}
        <Icon
          name="check"
          size={glyph}
          className="group-hover:hidden group-focus-visible:hidden"
        />
        <Icon
          name="minus"
          size={glyph}
          className="hidden group-hover:block group-focus-visible:block"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      style={box}
      onClick={() => add(payload)}
      aria-label={`Add ${row.symbol} to watchlist`}
      title={t('common.addToWatchlist')}
      className={cls(`${idle} hover:bg-green-tint`)}
    >
      <Icon name="plus" size={glyph} />
    </button>
  );
}
