import { useEffect, useRef, useState } from 'react';

/** Ease-out cubic — fast off the mark, settling into the final figure. */
const ease = (t) => 1 - (1 - t) ** 3;

/**
 * A figure that counts up to its value the first time it is scrolled into view.
 *
 * Two details that are easy to get wrong:
 *
 * - It starts on an IntersectionObserver, not on mount. The bar it lives in
 *   sits ~700px down the page, so a mount-triggered count finishes before
 *   anyone has scrolled to it and they only ever see the final number.
 * - It runs once. The observer disconnects on the first intersection, so
 *   scrolling back up does not replay it — a figure that re-counts every time
 *   it passes the fold reads as a glitch rather than an effect.
 *
 * Under prefers-reduced-motion it renders the final value immediately. This is
 * decorative movement attached to real-looking numbers, which is exactly what
 * that setting is for.
 *
 * The animated text is aria-hidden with the final value exposed to screen
 * readers alongside it, so assistive tech announces "$3B+" once instead of
 * narrating sixty intermediate frames.
 */
export default function CountUp({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  durationMs = 1600,
  className = '',
}) {
  const ref = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return undefined;
    }

    let raf = 0;
    let startedAt = 0;

    const step = (now) => {
      if (!startedAt) startedAt = now;
      const p = Math.min(1, (now - startedAt) / durationMs);
      setValue(to * ease(p));
      if (p < 1) raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          raf = requestAnimationFrame(step);
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, durationMs]);

  const format = (n) =>
    prefix +
    n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) +
    suffix;

  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{format(value)}</span>
      <span className="sr-only">{format(to)}</span>
    </span>
  );
}
