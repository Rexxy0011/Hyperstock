/**
 * The icon set, as inline 24x24 strokes. Inline rather than a library so the
 * bundle carries only what's used and every glyph inherits currentColor.
 */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  wallet: 'M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h14M17 12.5h2.5',
  news: 'M4 5h11v14H5a1 1 0 0 1-1-1zM15 9h5v9a1 1 0 0 1-1 1h-4zM7 8.5h5M7 12h5M7 15h3',
  market: 'M4 4v16h16M7.5 14.5 11 10l3 2.5 5.5-5.5M15.5 7h4v4',
  layers: 'M12 3 3 7.5 12 12l9-4.5zM3 12.5 12 17l9-4.5M3 17 12 21.5 21 17',
  community: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 8.5a2.5 2.5 0 1 0 0-5M17.5 19h3.5a5 5 0 0 0-4-4.9',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4 14H3.8a2 2 0 1 1 0-4H4a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 4V3.8a2 2 0 1 1 4 0V4a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20 10.6h.2a2 2 0 1 1 0 4H20a1.6 1.6 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6 9.5 12 15l6-5.5',
  chevronRight: 'M9.5 6 15 12l-5.5 6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5 10 17.5 19 7',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  megaphone: 'M4 10.5v3a1 1 0 0 0 1 1h2.5l7 3.5v-12l-7 3.5H5a1 1 0 0 0-1 1zM7.5 14.5V19M18 9.5a3.5 3.5 0 0 1 0 5',
  // The dot is a separate subpath so it renders as a full stop rather than a
  // stroked circle — at 20px a ring reads as a second, smaller glyph.
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.3 9.3a2.8 2.8 0 1 1 3.7 2.6c-.6.2-1 .8-1 1.5v.6M12 16.8v.4',
  phone: 'M6 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2L21 15v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3z',
  // The flap is a separate subpath rather than a closed triangle, so it reads
  // as a fold in the envelope instead of a filled wedge at small sizes. Used by
  // the admin nav's Messages entry; the contact page's own four rows render the
  // brand artwork in `assets/icons/contact-*.webp` instead, so there are
  // deliberately no `clock` or `pin` glyphs here to go stale beside them.
  mail: 'M3 6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3.5 7l8.5 6 8.5-6',
  logout: 'M9 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M15.5 12H9M13 8.5l3.5 3.5-3.5 3.5',
  trash: 'M4 7h16M9.5 7V5h5v2M6.5 7l.8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L18 7',
};

export default function Icon({ name, size = 18, strokeWidth = 1.6, className = '' }) {
  const d = PATHS[name];
  if (!d) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
