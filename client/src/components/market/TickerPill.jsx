import Link from '../ui/Link';
import PriceChange from './PriceChange';
import Money from './Money';
import { monogram } from '../../lib/monogram';

/**
 * Ported from the design system's components/market/TickerPill.jsx.
 * The monogram falls back to the first two characters of the symbol, exactly
 * as the source component does when no logo is supplied.
 */
export default function TickerPill({
  symbol,
  price,
  changePct,
  name = undefined,
  currency = 'USD',
  to = undefined,
  logo = undefined,
}) {
  // Router Link or plain div depending on whether the pill navigates.
  const Wrapper = /** @type {any} */ (to ? Link : 'div');
  const wrapperProps = to ? { to } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={[
        'inline-flex items-center gap-2.5 rounded-md border border-cool-grey bg-white px-3 py-2',
        'transition-colors duration-150 no-underline text-text-body',
        to ? 'cursor-pointer hover:bg-mist' : 'cursor-default',
      ].join(' ')}
    >
      {logo ? (
        <img src={logo} alt="" className="size-6 rounded-md" />
      ) : (
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-ink font-mono text-2xs font-semibold text-white">
          {monogram(symbol, name)}
        </span>
      )}

      <span className="flex flex-col leading-[1.2]">
        <span className="font-mono text-sm font-semibold">{symbol}</span>
        {name && <span className="text-2xs text-text-muted">{name}</span>}
      </span>

      <Money value={price} currency={currency} size={13} className="ml-1 font-medium" />
      <PriceChange value={changePct} size={12} />
    </Wrapper>
  );
}
