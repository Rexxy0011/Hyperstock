import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useQuery } from '@tanstack/react-query';
import { FiAlertCircle, FiExternalLink } from 'react-icons/fi';
import { get } from '../lib/api';
import { keys } from '../lib/queryClient';
import Badge from '../components/ui/Badge';
import Icon from '../components/ui/Icon';
import Tabs from '../components/ui/Tabs';

/**
 * The four markets, in the order the About page lists them. Each is a separate
 * feed and a separate cache key on the server — see news.service.js for which
 * provider is behind which, because it is not uniform.
 */
const ASSET_CLASSES = [
  { value: 'stocks', label: 'Stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'forex', label: 'Forex' },
  { value: 'commodities', label: 'Commodities' },
];

/**
 * Which provider serves which tab, stated on the tab rather than in one vague
 * line covering all four. Same reasoning as the Markets page: these are four
 * unrelated sources with four different characters, and a reader who knows a
 * forex headline came from FXStreet can weigh it themselves.
 */
const SOURCE_NOTE = {
  stocks: 'Equity headlines from Finnhub, with Nasdaq behind it as a fallback.',
  crypto: 'Merged from Finnhub, CoinTelegraph and Decrypt.',
  forex: 'FXStreet and Investing.com. Finnhub has no usable forex feed on this tier.',
  commodities: 'Nasdaq and Investing.com - no keyed provider covers commodities for free.',
};

/**
 * Two feeds on one screen: our own announcements pinned above market news.
 *
 * They are separate queries rather than one merged endpoint because they fail
 * differently. Announcements come out of our database and are either there or
 * the API is down; market news depends on a third-party vendor that can be
 * rate-limited, keyless or degraded to the RSS fallback. Merging them would
 * mean a vendor outage blanking our own operational notices, which are the
 * more important of the two.
 */
export default function News() {
  const { t } = useTranslation();
  const [assetClass, setAssetClass] = useState('stocks');

  const { data: announcements, isPending: annPending } = useQuery({
    queryKey: keys.announcements,
    queryFn: () => get('/announcements/active'),
    staleTime: 5 * 60_000,
  });

  const { data: news, isPending: newsPending } = useQuery({
    queryKey: keys.news(assetClass),
    queryFn: () => get(`/news?assetClass=${assetClass}&limit=24`),
    // The server refreshes from the vendor at most every NEWS_MIN_FETCH_MS, so
    // polling faster than this would only re-read the same cached rows.
    staleTime: 5 * 60_000,
    // Each tab is its own query. Holding the previous tab's rows while the
    // next resolves keeps the page from collapsing to a skeleton on every
    // click — the switch is near-instant once a tab has been visited.
    placeholderData: (prev) => prev,
  });

  const items = news?.items ?? [];
  const notices = announcements ?? [];

  // The newest story leads; everything after it is grouped by publication day.
  const [lead, ...rest] = items;
  const days = useMemo(() => groupByDay(rest), [rest]);

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="m-0 text-xl font-bold">{t('news.title')}</h1>
          <p className="mt-2 mb-0 text-sm text-text-muted">
            {t('news.lead')}
          </p>
        </div>

        {/* The freshest story's timestamp, NOT the response's `asOf`. That field
            is stamped when the JSON is built, so it always reads "just now" even
            when every headline is six hours old — which is worse than showing
            nothing, because it implies the feed is moving. */}
        {lead && (
          <span className="font-numeric text-xs text-text-muted tabular-nums">
            {t('news.latest', { time: relativeTime(lead.publishedAt, t) })}
          </span>
        )}
      </header>

      <Announcements notices={notices} pending={annPending} />

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-md font-bold">{t('news.headlines')}</h2>
          {news?.degraded && <DegradedPill source={news.source} empty={items.length === 0} />}
        </div>

        {/* Scrollable rather than wrapping: four tabs fit at 414 only just, and
            a wrapped second row of one tab reads as a mistake. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Tabs tabs={ASSET_CLASSES} value={assetClass} onChange={setAssetClass} className="w-max" />
        </div>
        <p className="mt-2 mb-6 text-xs text-text-muted">{SOURCE_NOTE[assetClass]}</p>

        {newsPending && <SkeletonFeed />}

        {!newsPending && items.length === 0 && <EmptyFeed />}

        {lead && <LeadStory article={lead} />}

        {days.map(({ label, articles }) => (
          <div key={label} className="mt-8">
            <div className="mb-4 flex items-center gap-3">
              <h3 className="m-0 text-xs font-medium tracking-wide text-text-muted uppercase">
                {label}
              </h3>
              <span className="h-px flex-1 bg-cool-grey" aria-hidden="true" />
              <span className="font-numeric text-xs text-text-muted tabular-nums">
                {articles.length}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {articles.map((a) => (
                <ArticleCard key={a.id} article={a} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- announcements */

/**
 * Ours, and marked as ours.
 *
 * The green rail is the whole point of this treatment. Before it, an
 * operational notice we wrote and a wire headline we merely relayed were the
 * same white card, so the one thing on this page the product can actually vouch
 * for looked like the least trustworthy thing on it.
 */
function Announcements({ notices, pending }) {
  const { t } = useTranslation();
  if (pending || notices.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <Icon name="megaphone" size={16} className="text-gain" />
        <h2 className="m-0 text-md font-bold">{t('news.announcements')}</h2>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {notices.map((a) => (
          <div
            key={a.id}
            className="rounded-lg border border-cool-grey border-l-4 border-l-gain bg-white p-5 shadow-card"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={a.status === 'Live' ? 'approved' : 'neutral'}>{a.status}</Badge>
              {a.audience !== 'All users' && <Badge>{a.audience}</Badge>}
              <span className="ml-auto font-numeric text-xs text-text-muted tabular-nums">
                {relativeTime(a.publishedAt, t)}
              </span>
            </div>

            <h3 className="m-0 text-md font-bold">{a.title}</h3>
            <p className="mt-2 mb-0 text-sm text-text-muted">{a.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- images */

/**
 * WHETHER A STORY HAS A PICTURE IS THE LAYOUT'S BIGGEST VARIABLE, and it does
 * not vary the way you would expect. Measured across 24 articles per tab, by
 * actually fetching every URL rather than counting the ones that carry a field:
 *
 *   forex        24 URLs → 23 load     essentially fully illustrated
 *   crypto       11 URLs → 11 load
 *   stocks        2 URLs →  2 load     Finnhub's own logos are stripped upstream
 *   commodities  10 URLs →  0 load     every one is Investing.com, every one 403s
 *
 * So a magazine grid built on a fixed image slot would look designed on forex,
 * empty on stocks, and — worst — would reserve ten image frames on commodities
 * for pictures that can never arrive.
 *
 * The layout therefore treats an image as optional and reflows without one,
 * rather than substituting a grey placeholder. A text-led card with a longer
 * standfirst reads as an editorial choice; a column of empty frames reads as a
 * broken page. `onError` drives it rather than a host blacklist, so a dead
 * image from any provider — now or later — degrades the same way.
 */
function useImage(url) {
  const [failed, setFailed] = useState(false);
  return { show: Boolean(url) && !failed, onError: () => setFailed(true) };
}

/* ---------------------------------------------------------------- lead story */

/**
 * The newest story, at the size a lead deserves. With a picture it is a
 * two-column card; without one the copy simply takes the full width and the
 * summary is allowed to run longer, so the tabs that have no imagery still open
 * on something that looks led rather than truncated.
 */
function LeadStory({ article }) {
  const image = useImage(article.imageUrl);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noreferrer"
      className={[
        'group grid gap-0 overflow-hidden rounded-xl border border-cool-grey bg-white',
        'no-underline shadow-card transition-colors hover:bg-hover',
        // The two-column split is conditional on there BEING a picture. Left
        // unconditional, a text-only lead lands in the image column and wraps
        // at half width beside an empty half — which is what the stocks and
        // commodities tabs are, most of the time.
        image.show ? 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : '',
      ].join(' ')}
    >
      {image.show && (
        <img
          src={article.imageUrl}
          alt=""
          onError={image.onError}
          className="aspect-video size-full bg-mist object-cover lg:aspect-auto lg:min-h-72"
        />
      )}

      <div className="flex flex-col justify-center p-6 lg:p-8">
        <Meta article={article} lead />

        <h3 className="mt-3 mb-0 text-lg font-bold text-text-body group-hover:text-gain">
          {article.headline}
          <FiExternalLink
            size={15}
            className="ml-2 inline shrink-0 align-baseline text-text-muted"
            aria-hidden="true"
          />
        </h3>

        {article.summary && (
          // Longer without a picture: the copy is carrying the card on its own.
          <p
            className={`mt-3 mb-0 text-sm text-text-muted ${
              image.show ? 'line-clamp-3' : 'line-clamp-4'
            }`}
          >
            {article.summary}
          </p>
        )}
      </div>
    </a>
  );
}

/* -------------------------------------------------------------------- cards */

function ArticleCard({ article }) {
  const image = useImage(article.imageUrl);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col overflow-hidden rounded-xl border border-cool-grey bg-white no-underline shadow-card transition-colors hover:bg-hover"
    >
      {image.show && (
        <img
          src={article.imageUrl}
          alt=""
          loading="lazy"
          onError={image.onError}
          // Tinted, because `loading="lazy"` means the box exists before the
          // bytes do — an untinted one is a white void the width of the card.
          className="aspect-video w-full bg-mist object-cover"
        />
      )}

      <div className="flex flex-1 flex-col p-4">
        <Meta article={article} />

        <h3 className="mt-2 mb-0 line-clamp-3 text-base font-semibold text-text-body group-hover:text-gain">
          {article.headline}
        </h3>

        {article.summary && (
          <p
            className={`mt-2 mb-0 text-sm text-text-muted ${
              image.show ? 'line-clamp-2' : 'line-clamp-4'
            }`}
          >
            {article.summary}
          </p>
        )}
      </div>
    </a>
  );
}

/** Publisher, age and up to three tickers — the same line at both sizes. */
function Meta({ article, lead = false }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`font-medium text-text-muted ${lead ? 'text-sm' : 'text-xs'}`}>
        {article.publisher}
      </span>
      <span className="text-xs text-text-muted" aria-hidden="true">
        ·
      </span>
      <span className="font-numeric text-xs text-text-muted tabular-nums">
        {relativeTime(article.publishedAt, t)}
      </span>

      {/* Cap the tickers. A single story can carry a dozen, and a row of them
          pushes the headline onto a second line for no benefit. */}
      {article.symbols.slice(0, 3).map((s) => (
        <Badge key={s} variant="exchange">
          {s}
        </Badge>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- states */

function DegradedPill({ source, empty }) {
  const label = empty
    ? 'No feed configured'
    : source === 'rss'
      ? 'Fallback feed'
      : 'Cached headlines';

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-tint px-2 py-1 text-xs font-medium text-amber">
      <FiAlertCircle size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyFeed() {
  return (
    <p className="m-0 rounded-xl border border-cool-grey bg-mist px-5 py-16 text-center text-sm text-text-muted">
      No headlines available right now. Market news needs a provider key - see{' '}
      <span className="font-mono">NEWS_PROVIDER</span> in <span className="font-mono">.env</span>.
    </p>
  );
}

/** Mirrors the real layout — one lead, then a grid — so nothing jumps on load. */
function SkeletonFeed() {
  return (
    <div aria-hidden="true">
      <div className="grid overflow-hidden rounded-xl border border-cool-grey bg-white lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="aspect-video animate-pulse bg-cool-grey lg:aspect-auto lg:min-h-64" />
        <div className="p-8">
          <span className="block h-3 w-32 animate-pulse rounded-sm bg-cool-grey" />
          <span className="mt-4 block h-5 w-4/5 animate-pulse rounded-sm bg-cool-grey" />
          <span className="mt-3 block h-3 w-full animate-pulse rounded-sm bg-cool-grey" />
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="overflow-hidden rounded-xl border border-cool-grey bg-white">
            <div className="aspect-video animate-pulse bg-cool-grey" />
            <div className="p-4">
              <span className="block h-3 w-24 animate-pulse rounded-sm bg-cool-grey" />
              <span className="mt-3 block h-4 w-4/5 animate-pulse rounded-sm bg-cool-grey" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- dates */

/**
 * "Today" / "Yesterday" / "Tuesday" / "August 12".
 *
 * A weekday name is only unambiguous inside a week — past that it wraps around
 * and "Tuesday" could mean either of two, so it becomes a date.
 */
function dayLabel(value) {
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return 'Recently';

  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(then)) / 86_400_000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString('en-US', { weekday: 'long' });
  return then.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/**
 * Groups in the order received rather than by sorting into buckets — the server
 * already returns publishedAt descending, and re-sorting here would be a second
 * owner of that ordering.
 */
function groupByDay(articles) {
  const groups = [];
  for (const article of articles) {
    const label = dayLabel(article.publishedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.articles.push(article);
    else groups.push({ label, articles: [article] });
  }
  return groups;
}

/**
 * "3h ago". A news feed is read by recency, and an absolute timestamp makes
 * the reader do that subtraction themselves. Falls back to a date past a week,
 * where "9d ago" stops being easier than "Aug 14".
 *
 * IT TAKES `t` RATHER THAN CALLING THE HOOK, because it is a plain function
 * called from several components and from inside a map — the same reason
 * `format.js` has its locale pushed in by `setNumberLocale` instead of reading
 * one. The date fallback is localised through `i18n.language` for the same
 * reason the digits are: "Aug 14" in a German feed is the one line on the page
 * still written in English.
 */
function relativeTime(value, t) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return t('time.justNow');
  if (mins < 60) return t('time.minsAgo', { count: mins });

  const hours = Math.round(mins / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });

  const days = Math.round(hours / 24);
  if (days <= 7) return t('time.daysAgo', { count: days });

  return new Date(then).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
}
