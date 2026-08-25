/**
 * The two-character avatar shown beside a ticker.
 *
 * The design system takes `symbol.slice(0, 2)`, which reads fine for lettered
 * tickers (AAPL -> AA) but produces meaningless duplicates for the numeric
 * listings on TSE, HKEX and SSE — 600519, 601398 and 601899 would all render
 * as "60". Numeric symbols fall back to the company's initials instead.
 */
export function monogram(symbol, name = '') {
  if (!/^\d+$/.test(symbol)) return symbol.slice(0, 2).toUpperCase();

  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return symbol.slice(0, 2);
}
