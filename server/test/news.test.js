import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItems } from '../src/market/news/rss.news.js';
import { _clean } from '../src/market/news/finnhub.news.js';
import { isUsListing } from '../src/market/providers/finnhubQuote.provider.js';
import { isOpen, minutesUntilOpen } from '../src/market/hours.js';

/**
 * The RSS adapter's parser, offline.
 *
 * It is tested and the Finnhub adapter is not because this is where every bug
 * has been: the transport is a fetch and a status check, but the parser has to
 * survive a feed that prefixes some elements and not others, encodes its
 * ampersands two and sometimes three times, and welds section headings onto
 * the first sentence of every summary. Each case below is a real defect that
 * shipped and was caught, not a hypothetical.
 *
 * Fixtures are trimmed from the live nasdaq.com feed.
 */

const item = (inner) => `<rss><channel><item>${inner}</item></channel></rss>`;

const BASE = `
  <title>Apple Cut Its EU App Store Commission</title>
  <link>https://www.nasdaq.com/articles/apple-cut-eu</link>
  <pubDate>Sun, 23 Aug 2026 21:35:01 +0000</pubDate>
`;

test('rss parser', async (t) => {
  await t.test('reads namespaced elements, not just bare ones', () => {
    const [a] = parseItems(
      item(`${BASE}<dc:creator>The Motley Fool</dc:creator><nasdaq:tickers>AAPL,MSFT</nasdaq:tickers>`),
    );

    // Matching `<tickers>` and `<creator>` alone silently yielded no bylines
    // and no ticker tags at all — the feed prefixes both.
    assert.equal(a.publisher, 'The Motley Fool');
    assert.deepEqual(a.symbols, ['AAPL', 'MSFT']);
  });

  await t.test('dedupes repeated tickers', () => {
    const [a] = parseItems(item(`${BASE}<nasdaq:tickers>NFLX,NFLX,UBER</nasdaq:tickers>`));
    assert.deepEqual(a.symbols, ['NFLX', 'UBER']);
  });

  await t.test('stamps the requested symbol when the feed tags nothing', () => {
    const [a] = parseItems(item(BASE), { fallbackSymbol: 'TSLA' });
    assert.deepEqual(a.symbols, ['TSLA']);
  });

  await t.test('carries the asset class and publisher of the feed it came from', () => {
    // Neither is derivable from the article. No free feed tags its market
    // reliably, so the class is whichever feed was asked for.
    const [a] = parseItems(item(BASE), { assetClass: 'forex', publisher: 'FXStreet' });
    assert.equal(a.assetClass, 'forex');
    assert.equal(a.sourceName, 'FXStreet');
    assert.equal(a.publisher, 'FXStreet', 'falls back to the feed name with no byline');
  });

  await t.test('prefers an article byline over the feed name', () => {
    const [a] = parseItems(item(`${BASE}<dc:creator>Reuters</dc:creator>`), {
      publisher: 'Nasdaq',
    });
    assert.equal(a.publisher, 'Reuters');
    assert.equal(a.sourceName, 'Nasdaq', 'the feed is still recorded separately');
  });

  await t.test('reads the image out of an enclosure attribute', () => {
    // FXStreet and Investing.com put images on every item; Nasdaq has none at
    // all. The value is in an attribute of a self-closing tag, so the text
    // extractor cannot reach it.
    const [withImg] = parseItems(
      item(`${BASE}<enclosure url="https://editorial.fxsstatic.com/i/nzd-usd.jpg" type="image/jpg"/>`),
    );
    const [without] = parseItems(item(BASE));

    assert.equal(withImg.imageUrl, 'https://editorial.fxsstatic.com/i/nzd-usd.jpg');
    assert.equal(without.imageUrl, '', 'no enclosure means the ticker tile, not a broken frame');
  });

  await t.test('takes the author element when the feed uses it instead of creator', () => {
    // Investing.com emits <author>, FXStreet emits neither, Nasdaq <dc:creator>.
    const [a] = parseItems(item(`${BASE}<author>Investing.com</author>`), { publisher: 'x' });
    assert.equal(a.publisher, 'Investing.com');
  });

  await t.test('decodes double- and triple-encoded entities', () => {
    const [a] = parseItems(
      item(`
        <title>Tesla&amp;rsquo;s &amp;quot;Show Me&amp;quot; Phase</title>
        <link>https://example.com/a</link>
        <pubDate>Sun, 23 Aug 2026 21:35:01 +0000</pubDate>
        <description>Roundhill AI &amp;amp; Technology ETF</description>
      `),
    );

    assert.equal(a.headline, 'Tesla’s "Show Me" Phase');
    assert.equal(a.summary, 'Roundhill AI & Technology ETF');
    assert.doesNotMatch(a.headline + a.summary, /&[a-z]+;/i, 'no entity survives undecoded');
  });

  await t.test('a double-encoded tag stays text and never becomes markup', () => {
    // The reason the second decode pass excludes lt/gt. React escapes on
    // render anyway, but the parser must not be the thing relying on that.
    const [a] = parseItems(
      item(`
        <title>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</title>
        <link>https://example.com/b</link>
        <pubDate>Sun, 23 Aug 2026 21:35:01 +0000</pubDate>
      `),
    );

    assert.equal(a.headline, '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.doesNotMatch(a.headline, /<script/i);
  });

  await t.test('unwedges a section heading welded to the summary', () => {
    const [a] = parseItems(
      item(`${BASE}<description>Key PointsDuring the second quarter, Pershing bought Netflix.</description>`),
    );
    assert.equal(a.summary, 'During the second quarter, Pershing bought Netflix.');
  });

  await t.test('leaves a legitimate "Key Points " opening alone', () => {
    const [a] = parseItems(item(`${BASE}<description>Key Points are listed below.</description>`));
    assert.equal(a.summary, 'Key Points are listed below.');
  });

  await t.test('drops items with no url, headline or usable date', () => {
    const missingUrl = parseItems(item('<title>No link</title><pubDate>Sun, 23 Aug 2026 21:35:01 +0000</pubDate>'));
    const badDate = parseItems(item(`<title>T</title><link>https://e.com/c</link><pubDate>not a date</pubDate>`));

    assert.equal(missingUrl.length, 0);
    assert.equal(badDate.length, 0);
  });

  await t.test('strips markup and collapses the whitespace the feed indents with', () => {
    const [a] = parseItems(
      item(`${BASE}<description>\n     <p>Shares rose</p>   sharply.\n  </description>`),
    );
    assert.equal(a.summary, 'Shares rose sharply.');
  });

  await t.test('returns an empty list rather than throwing on junk', () => {
    assert.deepEqual(parseItems('<html>404 not found</html>'), []);
    assert.deepEqual(parseItems(''), []);
  });
});

/**
 * The Finnhub adapter's cleanup pass.
 *
 * Not the fetch — that is a status check — but the three transforms that make
 * its Reuters ingestion presentable. Each was measured on a live 20-article
 * sample where the same 14 items were affected by all three at once.
 */
test('finnhub cleanup', async (t) => {
  await t.test('drops house stand-ins passed off as article images', () => {
    // Both were found in live feeds: the first on 14 of 20 stocks articles,
    // the second on 4 of the crypto ones. Matching only "/logo/" caught the
    // first and missed the second, which is why the rule is the host.
    assert.equal(
      _clean.image('https://static2.finnhub.io/file/finnhub/logo/reuters_logo.jpeg'),
      '',
    );
    assert.equal(
      _clean.image('https://static2.finnhub.io/file/publicdatany/hmpimage/cointelegraph.webp'),
      '',
    );
  });

  await t.test('keeps real photographs from a publisher CDN', () => {
    for (const photo of [
      'https://image.cnbcfm.com/api/v1/image/108315442-1780426534373-photo_181.jpg',
      'https://cryptocurrencynews.com/wp-content/uploads/2026/08/feecb3d639276a34.jpg',
    ]) {
      assert.equal(_clean.image(photo), photo);
    }
  });

  await t.test('strips a trailing publisher suffix from the headline', () => {
    // The byline is already rendered beside the headline; this made it twice.
    assert.equal(
      _clean.headline('Oil falls as US prepares to unveil new Iran sanctions - Reuters', 'Reuters'),
      'Oil falls as US prepares to unveil new Iran sanctions',
    );
  });

  await t.test('leaves a dash that is not the publisher alone', () => {
    const h = 'MarketBeat Week in Review - 08/17';
    assert.equal(_clean.headline(h, 'Reuters'), h);
    assert.equal(_clean.headline('Bank of America - a deep dive', 'CNBC'), 'Bank of America - a deep dive');
  });

  await t.test('drops a summary that only restates the headline', () => {
    // Note the trailing publisher on the summary: the two are never exactly
    // equal, which is why this compares by prefix and not by equality.
    assert.equal(
      _clean.summary(
        'Father of sailor aboard USS Abraham Lincoln taken into US immigration detention  Reuters',
        'Father of sailor aboard USS Abraham Lincoln taken into US immigration detention - Reuters',
      ),
      '',
    );
  });

  await t.test('keeps a summary that adds something', () => {
    const s = 'Crude slid 2% after Washington signalled fresh measures against Tehran.';
    assert.equal(_clean.summary(s, 'Oil falls as US prepares new sanctions'), s);
  });

  await t.test('survives missing fields rather than throwing', () => {
    assert.equal(_clean.image(undefined), '');
    assert.equal(_clean.headline(undefined, undefined), '');
    assert.equal(_clean.summary(undefined, undefined), '');
  });
});

/**
 * The venue gate on live quotes.
 *
 * This is one assertion standing in front of a bug that already happened:
 * gating on ticker shape sent a bare `AIR` to Finnhub, which resolves bare
 * tickers against US listings, and wrote AAR Corp's NYSE price onto the row
 * labelled "Airbus · Euronext". The row looked live and confident and was
 * quoting a different company.
 */
test('live quotes are gated on the listing venue', async (t) => {
  await t.test('quotes US venues', () => {
    assert.equal(isUsListing('NYSE'), true);
    assert.equal(isUsListing('NASDAQ'), true);
  });

  await t.test('refuses every venue the free tier 403s', () => {
    // All six return 403 from Finnhub, and all six have tickers that collide
    // with unrelated US listings.
    for (const venue of ['Euronext', 'XETRA', 'LSE', 'TSE', 'HKEX', 'SSE']) {
      assert.equal(isUsListing(venue), false, `${venue} must not be quoted`);
    }
  });

  await t.test('is not fooled by a bare ticker', () => {
    // AIR is Airbus on Euronext and AAR Corp on the NYSE; ALV is Allianz on
    // XETRA and Autoliv on the NYSE. The ticker cannot decide this — only the
    // venue can.
    assert.equal(isUsListing('Euronext'), false);
    assert.equal(isUsListing('XETRA'), false);
  });

  await t.test('treats an unknown venue as not quotable', () => {
    assert.equal(isUsListing(undefined), false);
    assert.equal(isUsListing(''), false);
  });
});

/**
 * Exchange session hours.
 *
 * Worth pinning because the failure is silent in both directions: a venue that
 * reads open when it is shut makes a frozen table look broken, and one that
 * reads shut when it is open hides a genuinely dead feed behind a plausible
 * excuse. The DST cases are the reason this uses Intl rather than a stored
 * offset — New York is UTC-5 in January and UTC-4 in July.
 */
test('exchange hours', async (t) => {
  const NYSE = { openTime: '09:30', closeTime: '16:00', timezone: 'America/New_York' };
  // 14:00 UTC is 09:00 EST in winter — before the bell — and 10:00 EDT in
  // summer, after it. One instant, two answers, decided by the date.
  const winter = new Date('2026-01-12T14:00:00Z');
  const summer = new Date('2026-07-13T14:00:00Z');

  await t.test('resolves daylight saving from the zone, not an offset', () => {
    assert.equal(isOpen(NYSE, winter), false, '09:00 EST is before the open');
    assert.equal(isOpen(NYSE, summer), true, '10:00 EDT is mid-session');
  });

  await t.test('is shut at the weekend', () => {
    // Saturday, mid-session by clock time.
    assert.equal(isOpen(NYSE, new Date('2026-07-11T14:00:00Z')), false);
    assert.equal(isOpen(NYSE, new Date('2026-07-12T14:00:00Z')), false);
  });

  await t.test('closes at the bell, not after it', () => {
    // 16:00 EDT exactly — the close is exclusive.
    assert.equal(isOpen(NYSE, new Date('2026-07-13T20:00:00Z')), false);
    assert.equal(isOpen(NYSE, new Date('2026-07-13T19:59:00Z')), true);
  });

  await t.test('counts forward to the next open', () => {
    assert.equal(minutesUntilOpen(NYSE, summer), 0, 'already trading');
    // Friday after the close → Monday's bell, three days later.
    const friEvening = new Date('2026-07-10T21:00:00Z');
    assert.equal(minutesUntilOpen(NYSE, friEvening), 3 * 1440 + 570 - 1020);
  });

  await t.test('treats an exchange with no zone as shut rather than guessing', () => {
    assert.equal(isOpen({ openTime: '09:30', closeTime: '16:00' }), false);
    assert.equal(isOpen(undefined), false);
  });
});
