import { useEffect, useRef } from 'react';

/**
 * A muted, looping video sitting behind a section's content.
 *
 * It is deliberately NOT an `autoPlay` element. autoPlay starts the download
 * on page load, and this file is ~1MB sitting three screens below the fold —
 * every visitor who bounced at the hero paid for it. `preload="none"` plus an
 * explicit play() on intersection means the bytes are only fetched by someone
 * who is about to see the section. `rootMargin` starts that fetch ~300px early
 * so the first frame is decoded by the time the section arrives.
 *
 * The poster is load-bearing rather than a nicety. It is what renders when
 * prefers-reduced-motion is set — a looping background is exactly the ambient
 * movement that setting exists to stop — and again when a browser refuses the
 * play() call, which it may do regardless of `muted`. In both cases the section
 * degrades to a still frame rather than to an empty box.
 *
 * aria-hidden and tabIndex -1: it carries no information and must not be a tab
 * stop. Anything the section means is in the text on top of it.
 */
export default function VideoBackdrop({ src, poster, className = '' }) {
  const ref = useRef(/** @type {HTMLVideoElement | null} */ (null));

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          // Rejects when the browser declines autoplay; the poster stands in.
          el.play().catch(() => {});
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);

    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
      className={className}
    />
  );
}
