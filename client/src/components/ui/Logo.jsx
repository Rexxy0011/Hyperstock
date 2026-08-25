import Link from './Link';
import { assets } from '../../assets/assets';

/**
 * The single place the brand mark is rendered. Every nav, drawer, footer and
 * auth screen goes through here, so replacing the artwork means replacing one
 * file in assets/brand — no usage sites change.
 *
 * The artwork carries "HYPER STOCKS" inside the disc, but at nav size that text
 * is ~5px tall and unreadable, so small placements still pass withWordmark to
 * get a legible label. Larger placements can drop it.
 */
export default function Logo({
  size = 28,
  withWordmark = true,
  to = '/',
  className = '',
}) {
  const content = (
    <>
      <img
        src={assets.logoMark}
        alt=""
        width={size}
        height={size}
        className="shrink-0"
        style={{ width: size, height: size }}
      />
      {/* The wordmark inherits colour rather than pinning text-void, so the
          mark works on the ink footer as well as on white. --color-void and
          --color-text-body are both #111111, so light placements are
          unchanged. */}
      {withWordmark && (
        <span className="text-sm font-extrabold tracking-[-0.02em]">HyperStocks</span>
      )}
    </>
  );

  const classes = `flex shrink-0 items-center gap-2 no-underline ${className}`;

  // `to={null}` renders a plain span — used where the logo is decorative rather
  // than a link back to the home page.
  if (!to) return <span className={classes}>{content}</span>;

  return (
    <Link to={to} className={classes} aria-label="HyperStocks home">
      {content}
    </Link>
  );
}
