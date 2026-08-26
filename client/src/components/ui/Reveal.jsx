import { useEffect, useRef, useState } from 'react';

/**
 * Reads the setting once, at mount. Passed to `useState` as a LAZY INITIALIZER
 * rather than called in the effect, so a reduced-motion visitor's first paint
 * is already correct — checking it afterwards would render one frame at
 * `opacity-0` and then snap, which is a flicker on the exact setting that
 * exists to prevent one.
 */
const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fades and lifts its children the first time they scroll into view.
 *
 * This is the same shape as `CountUp` — IntersectionObserver, runs once,
 * disconnects on the first intersection — minus the RAF loop, because the
 * animation itself is CSS (`--animate-reveal`). That is deliberate rather than
 * incidental: it means `prefers-reduced-motion` is still owned by the one block
 * in styles/theme.css that already kills the hourglass, `rise` and the marquees,
 * instead of a second copy of that decision living in JavaScript and free to
 * drift from it. It is also why this is 40 lines and not a dependency.
 *
 * THE TRIGGER IS A NEGATIVE rootMargin, NOT A THRESHOLD, and the difference is
 * a real bug rather than a preference. A threshold is a ratio of the ELEMENT,
 * so `threshold: 0.12` on a section taller than ~8x the viewport can never be
 * satisfied — at 900px of viewport against a 10,000px section the observer tops
 * out at 9% and the content stays invisible forever. Shrinking the root's
 * bottom edge fires at a fixed distance into the viewport whatever the element
 * measures.
 *
 * It runs ONCE. Scrolling back up must not replay it: content that re-animates
 * every time it passes the fold reads as a glitch, and on a page this long it
 * would happen constantly.
 *
 * `delay` is what stagger is built from — a grid passes `i * 70` and the cards
 * arrive in sequence. The keyframes carry `both`, so the element holds the
 * hidden state through the delay rather than flashing in and back out.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {string=} props.as       element tag, for when a wrapper div would
 *                                 break the layout it sits in
 * @param {number=} props.delay    ms, for staggering a row or grid
 * @param {string=} props.className
 */
export default function Reveal({ children, as = 'div', delay = 0, className = '' }) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));

  // Captured once. A visitor who changes the OS setting mid-session keeps
  // whatever was decided at mount — but the reduced-motion block in theme.css
  // still kills `.animate-reveal` on anything already showing, so the outcome
  // is correct either way. Same trade CountUp makes.
  const [reduced] = useState(prefersReduced);
  const [shown, setShown] = useState(reduced);

  useEffect(() => {
    if (shown) return undefined;

    const el = ref.current;
    // No observer means no way to know when this scrolls in, and content that
    // never appears is a far worse failure than content that never animates.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }

    // AN ELEMENT WITH NO BOX CAN NEVER INTERSECT, and IntersectionObserver does
    // not re-fire when it later gains one — so a `hidden lg:block` child would
    // be stranded at `opacity: 0` until something happened to scroll. Measured
    // on Landing's flow arrow: at 414 it is `display: none` and correctly
    // invisible, but resizing to 1440 left it `display: block; opacity: 0`,
    // recovering only on the next scroll.
    //
    // Nothing without a box is visible in the first place, so revealing it now
    // costs no animation anybody could have seen and makes stranding
    // impossible. Layout has already run — this is an effect, not a render.
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) {
      setShown(true);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setShown(true);
        }
      },
      // Fires 12% of a viewport in, so a section is committed to the screen
      // before it starts arriving rather than animating against the very edge.
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);

    return () => io.disconnect();
  }, [shown]);

  // A runtime-chosen tag cannot be expressed under checkJs. The narrow `any`
  // cast is the repo's sanctioned escape hatch for exactly this, alongside
  // Mongoose's `-1 | 1` sort literals.
  const Tag = /** @type {any} */ (as);

  const motion = shown ? (reduced ? '' : 'animate-reveal') : 'opacity-0';

  return (
    <Tag
      ref={ref}
      className={`${className} ${motion}`.trim()}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
