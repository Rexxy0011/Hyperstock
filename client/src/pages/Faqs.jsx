import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';
import { useAccountCta } from '../hooks/useAccountCta';
import Icon from '../components/ui/Icon';
import { useFaqs, FAQ_COUNT } from './faqContent';

/**
 * `/faqs` — the reference layout: a hero, then a sticky category rail beside a
 * single accordion list.
 *
 * ONE LIST, NOT ONE LIST PER CATEGORY. The rail scrolls to a heading rather
 * than filtering, so a reader can move through all nineteen answers in order
 * without ever discovering that a control exists. Filtering would hide
 * eighteen-nineteenths of the page behind a click and make Cmd-F useless, which
 * on a page of answers is the search people actually reach for.
 *
 * MULTIPLE ANSWERS MAY BE OPEN AT ONCE, which is a departure from the usual
 * accordion. These are reference material: a reader comparing what documents
 * are needed against how long verification takes has to hold two answers at
 * once, and an accordion that closes the first one on opening the second turns
 * that into re-clicking. Nothing here is a wizard step, so nothing needs to be
 * mutually exclusive.
 *
 * It lives in `PublicLayout` next to `/about`: marketing regardless of session,
 * so it keeps the marketing footer whether or not somebody is signed in.
 */
export default function Faqs() {
  const categories = useFaqs();

  return (
    <>
      <Hero />

      <section className="mx-auto w-full max-w-300 px-4 pb-20 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
          <CategoryRail categories={categories} />

          <div className="min-w-0">
            {categories.map((category) => (
              <div key={category.id} className="mb-12 last:mb-0">
                {/*
                  `scroll-mt` is load-bearing, not spacing. The nav is sticky at
                  65px, so an anchor jump lands the heading UNDER it — the
                  reader arrives at what looks like the middle of the previous
                  answer and has to scroll back up to find out where they are.
                */}
                <h2
                  id={category.id}
                  className="mb-5 scroll-mt-24 text-lg font-semibold text-void"
                >
                  {category.label}
                </h2>

                <ul className="m-0 list-none p-0">
                  {category.faqs.map((faq) => (
                    <FaqItem key={faq.n} faq={faq} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ClosingCta />
    </>
  );
}

/* -------------------------------------------------------------------- hero */

function Hero() {
  const cta = useAccountCta();
  const { t } = useTranslation();

  return (
    <section className="border-b border-cool-grey bg-mist/40">
      <div className="mx-auto w-full max-w-300 px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
        <p className="m-0 text-2xs font-medium tracking-[0.14em] text-text-muted uppercase">
          {t('faq.eyebrow')}
        </p>
        <h1 className="mt-4 mb-0 max-w-200 text-[clamp(28px,4vw,42px)] font-bold text-void">
          {t('faq.title')}
        </h1>
        <p className="mt-5 mb-0 max-w-160 text-md text-text-body">
          {t('faq.lead')}
        </p>
        <p className="mt-3 mb-0 max-w-160 text-sm text-text-muted">
          {t('faq.sub')}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button to={cta.to}>{cta.label}</Button>
          <Button to="/contact" variant="secondary">
            {t('faq.contactSupport')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- rail */

/**
 * The category navigation: a sticky column on desktop, a horizontally scrolling
 * strip on mobile.
 *
 * THE ACTIVE STATE IS OBSERVED, NOT ASSUMED. Setting it on click alone goes
 * wrong the moment somebody scrolls instead of clicking — the rail keeps
 * pointing at whatever was pressed last, or at nothing. An IntersectionObserver
 * on the headings means the rail follows the reader wherever they came from.
 *
 * The `rootMargin` pulls the trigger line to the top quarter of the viewport so
 * a heading counts as current once it has settled under the nav, not the moment
 * its first pixel appears at the bottom of the screen — which would light up
 * the NEXT category while the reader is still in this one.
 */
function CategoryRail({ categories }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(categories[0].id);
  const stripRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    const headings = categories.map((c) => document.getElementById(c.id)).filter(Boolean);
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-88px 0px -70% 0px', threshold: 0 },
    );

    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
    // Re-observed on a language change: the headings are replaced, and an
    // observer still holding the old nodes would never fire again.
  }, [categories]);

  // On mobile the strip scrolls horizontally, so the active chip is centered
  // by scrolling only the container. We avoid calling `scrollIntoView` because
  // that hijacks the window's vertical scroll position on mobile touch screens.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const chip = strip.querySelector(`[data-chip="${active}"]`);
    if (chip instanceof HTMLElement) {
      const chipLeft = chip.offsetLeft;
      const chipWidth = chip.offsetWidth;
      const stripWidth = strip.offsetWidth;
      const targetScroll = chipLeft - (stripWidth - chipWidth) / 2;
      strip.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [active]);

  return (
    <>
      {/* Mobile: a scrolling strip above the list. `-mx-4 px-4` lets it bleed to
          the screen edges so the last chip does not look clipped by a margin. */}
      <div
        ref={stripRef}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 pt-1 lg:hidden scrollbar-none overscroll-x-contain"
      >
        {categories.map((c) => (
          <a
            key={c.id}
            href={`#${c.id}`}
            data-chip={c.id}
            className={[
              'shrink-0 rounded-lg border px-3 py-2 text-2xs font-medium whitespace-nowrap no-underline transition-colors',
              active === c.id
                ? 'border-void bg-ink text-white'
                : 'border-cool-grey text-text-muted hover:text-void',
            ].join(' ')}
          >
            {c.label}
          </a>
        ))}
      </div>

      {/* Desktop: sticky, so the categories stay reachable through a long page —
          which is the entire reason this column exists rather than a list of
          links at the top. */}
      <nav aria-label="FAQ categories" className="hidden lg:block">
        <div className="sticky top-24">
          <p className="m-0 mb-4 text-2xs font-medium tracking-[0.14em] text-text-muted uppercase">
            {t('faq.categories')}
          </p>
          <ul className="m-0 list-none p-0">
            {categories.map((c) => (
              <li key={c.id}>
                <a
                  href={`#${c.id}`}
                  aria-current={active === c.id ? 'true' : undefined}
                  className={[
                    'block border-l-2 py-2 pl-3 text-sm no-underline transition-colors',
                    active === c.id
                      ? 'border-gain font-medium text-void'
                      : 'border-cool-grey text-text-muted hover:border-slate/40 hover:text-void',
                  ].join(' ')}
                >
                  {c.label}
                </a>
              </li>
            ))}
          </ul>

          <p className="mt-6 mb-0 text-2xs text-text-muted">
            {t('faq.answered', { count: FAQ_COUNT })}
          </p>
        </div>
      </nav>
    </>
  );
}

/* --------------------------------------------------------------- accordion */

/**
 * One question.
 *
 * `grid-template-rows: 0fr → 1fr` is what animates the open, and it is the only
 * way to transition to a height nobody has measured. `height: auto` is not
 * animatable, and the usual workaround — a fixed `max-height` large enough for
 * the longest answer — makes every short answer open at the speed of the
 * longest one, because the transition spends most of its duration travelling
 * through empty space. These answers run from two lines to eight.
 */
function FaqItem({ faq }) {
  const cta = useAccountCta();
  const [open, setOpen] = useState(false);
  const panelId = `faq-panel-${faq.n}`;

  return (
    <li className="border-b border-cool-grey">
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full cursor-pointer items-start gap-4 bg-transparent py-5 text-left transition-colors hover:text-void"
        >
          <span className="mt-0.5 shrink-0 font-numeric text-2xs tabular-nums text-text-muted">
            {faq.n}
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-void">{faq.q}</span>
          {/*
            A PLUS THAT ROTATES INTO A MINUS, matching the reference. One glyph
            rotating 45° rather than swapping two icons: a swap has no
            in-between state, so the control changes on a single frame while the
            panel beneath it takes 300ms — and the two read as unrelated.
          */}
          <Icon
            name="plus"
            size={16}
            className={`mt-0.5 shrink-0 text-text-muted transition-transform duration-300 ${
              open ? 'rotate-135' : ''
            }`}
          />
        </button>
      </h3>

      <div
        id={panelId}
        // `grid` + `0fr/1fr` is the animation; `invisible` keeps the collapsed
        // content out of the tab order and away from screen readers, which
        // `overflow: hidden` alone does not do.
        className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className={`overflow-hidden ${open ? '' : 'invisible'}`}>
          <div className="flex flex-col gap-3 pt-1 pb-6 pl-9 text-sm text-text-muted">
            {faq.body.map((block, i) =>
              // A block is a paragraph string, or an object carrying a list.
              // Typed by shape rather than a discriminator so the translation
              // files stay readable — most entries are just sentences.
              block && block.list ? (
                <ul key={i} className="m-0 flex list-none flex-col gap-2 p-0">
                  {block.list.map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-gain" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="m-0 max-w-200 leading-relaxed">
                  {block}
                </p>
              ),
            )}

            {/* The answer's own button. Signed in, the account already
                exists, so it offers the way back into the product rather than
                a signup form the reader has plainly already completed — the
                copy above it still describes the process, which is fine, since
                it is reference material rather than a step being asked for. */}
            {faq.cta && (
              <Button
                to={cta.signedIn ? cta.to : faq.cta.to}
                size="sm"
                className="mt-2 self-start"
              >
                {cta.signedIn ? cta.label : faq.cta.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ closing */

/**
 * The page ends on an action rather than on the nineteenth answer.
 *
 * IT IS LIGHT, AND THE FIRST VERSION WAS NOT. On ink it butted straight into
 * the marketing footer, which is also ink — two dark bands with nothing between
 * them read as one shapeless block with a hole in the middle, and the closing
 * ask disappeared into the site furniture below it. `mist` separates the two,
 * so the footer becomes the end of the page and this stays the last thing
 * addressed to the reader. It is what the reference does as well.
 */
function ClosingCta() {
  const cta = useAccountCta();
  const { t } = useTranslation();

  return (
    <section className="border-t border-cool-grey bg-mist/50">
      <div className="mx-auto w-full max-w-300 px-4 py-20 text-center sm:px-6 lg:px-10">
        <h2 className="m-0 text-[clamp(24px,3vw,34px)] font-bold text-void">
          {t('faq.closingTitle')}
        </h2>
        <p className="mx-auto mt-5 mb-0 max-w-150 text-sm text-text-body">
          {t('faq.closingBody')}
        </p>
        <p className="mx-auto mt-2 mb-0 max-w-150 text-sm text-text-muted">
          {t('faq.closingSub')}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button to="/contact">{t('faq.contactSupport')}</Button>
          <Button to={cta.to} variant="secondary">
            {cta.label}
          </Button>
        </div>
      </div>
    </section>
  );
}
