import { money } from '../../lib/format';

/**
 * The sole owner of currency rendering. Always `font-numeric` + tabular-nums,
 * so figures line up column-to-column.
 *
 * NOT the mono face. A balance is a figure, not a token — money in Geist Mono
 * reads as a code listing. The column alignment that mono was there for comes
 * from the tabular figure SET, which the body face has: measured, system-ui
 * spans 31px between "111111" and "000000" at 32px normally and exactly 0 with
 * tabular figures on. See `--font-numeric` in theme.css.
 */
export default function Money({
  value,
  currency = 'USD',
  signed = false,
  size = undefined,
  className = '',
  as = 'span',
}) {
  // Runtime-chosen element: TS cannot resolve intrinsic props for a variable tag.
  const Tag = /** @type {any} */ (as);
  return (
    <Tag
      className={`font-numeric tabular-nums ${className}`}
      style={size ? { fontSize: size } : undefined}
    >
      {money(value, currency, { signed })}
    </Tag>
  );
}
