import { useState } from 'react';
import {
  SiBinance,
  SiBitcoin,
  SiBnbchain,
  SiCardano,
  SiDogecoin,
  SiEthereum,
  SiLitecoin,
  SiPolygon,
  SiRipple,
  SiSolana,
  SiTether,
} from 'react-icons/si';

/**
 * A real brand mark for a coin or a chain.
 *
 * BUNDLED VECTOR FIRST, remote logo second, initials last — in that order for
 * three reasons. The vector is already in the bundle (`react-icons` is a
 * dependency this app has anyway), so it paints on the first frame instead of
 * after a CDN round trip; it stays crisp at any size; and it cannot 404, which
 * a vendor URL eventually will.
 *
 * The remote logo is kept as the second step rather than dropped, because it
 * covers every coin CoinGecko lists and this map covers eleven. A coin outside
 * both still renders — as its own initials, never as a broken frame.
 *
 * NOTHING HERE IS DRAWN BY HAND. Tron has no mark in `react-icons`, so TRC20
 * falls through to the Tron Foundation's own artwork via TRX rather than an
 * approximation of a trademark from memory, which is the kind of thing that is
 * both wrong and rude.
 */

/** Brand colours, as each project publishes them. */
const MARKS = {
  BTC: { Glyph: SiBitcoin, color: '#F7931A' },
  ETH: { Glyph: SiEthereum, color: '#627EEA' },
  USDT: { Glyph: SiTether, color: '#26A17B' },
  SOL: { Glyph: SiSolana, color: '#9945FF' },
  DOGE: { Glyph: SiDogecoin, color: '#C2A633' },
  BNB: { Glyph: SiBnbchain, color: '#F0B90B' },
  BUSD: { Glyph: SiBinance, color: '#F0B90B' },
  LTC: { Glyph: SiLitecoin, color: '#345D9D' },
  XRP: { Glyph: SiRipple, color: '#23292F' },
  ADA: { Glyph: SiCardano, color: '#0033AD' },
  MATIC: { Glyph: SiPolygon, color: '#8247E5' },
  // Wrapped and pegged variants carry the mark of what they track, which is
  // what wallets show and what a depositor is looking for. The row's own text
  // is where the distinction is made — an icon cannot carry "not native BTC".
  BTCB: { Glyph: SiBitcoin, color: '#F7931A' },
  WBTC: { Glyph: SiBitcoin, color: '#F7931A' },
  WETH: { Glyph: SiEthereum, color: '#627EEA' },
};

/**
 * Networks resolve to the mark of the chain they are, not of the token being
 * sent: USDT on BEP20 is a Tether balance moving over BNB Smart Chain, and the
 * row is about the chain.
 */
const NETWORK_MARKS = {
  BITCOIN: 'BTC',
  ERC20: 'ETH',
  ETHEREUM: 'ETH',
  BEP20: 'BNB',
  SPL: 'SOL',
  SOLANA: 'SOL',
  DOGECOIN: 'DOGE',
  // TRC20 is deliberately absent — see the note above.
};

/**
 * @param {{ symbol?: string, network?: string, logoUrl?: string,
 *   size?: number, className?: string }} props
 */
export default function CoinIcon({
  symbol = '',
  network = '',
  logoUrl = '',
  size = 28,
  className = '',
}) {
  const [failed, setFailed] = useState(false);

  const key = network
    ? NETWORK_MARKS[network.toUpperCase()]
    : symbol.toUpperCase();
  const mark = key ? MARKS[key] : null;

  const box = {
    width: size,
    height: size,
    // The tint is the brand colour at 12%, so each row reads as its own coin
    // without a wall of saturated circles.
    ...(mark && { backgroundColor: `${mark.color}1F`, color: mark.color }),
  };

  const shell = `inline-flex shrink-0 items-center justify-center rounded-full ${className}`;

  if (mark) {
    const { Glyph } = mark;
    return (
      <span style={box} className={shell} aria-hidden="true">
        <Glyph size={Math.round(size * 0.56)} />
      </span>
    );
  }

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-mist ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      style={{ width: size, height: size }}
      className={`${shell} bg-mist font-mono text-2xs font-semibold text-text-muted`}
      aria-hidden="true"
    >
      {(network || symbol).slice(0, 3)}
    </span>
  );
}
