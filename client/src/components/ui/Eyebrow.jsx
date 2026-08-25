/**
 * The small outlined capsule that labels a section — ABOUT US, OUR COMMITMENT.
 *
 * `rounded-full` is the third sanctioned use in the codebase, after Button's
 * `pill` and the Landing security heading; see the note in styles/theme.css.
 * It lives in a component for the same reason `pill` does: passed through
 * `className` it would lose silently, because Tailwind resolves conflicting
 * radii by their position in the generated stylesheet and `.rounded-md` is
 * emitted after `.rounded-full`.
 *
 * `Badge` is the neighbouring component but the wrong one here — it owns the
 * product's status enums (Listed, Filled, Pending), and widening it to also
 * mean "section label" would put marketing copy through the status palette.
 */
export default function Eyebrow({ onDeep = false, className = '', children }) {
  // `onDeep` is a prop and not a caller-supplied class for the same reason the
  // radius is: `border-white/25` and `border-slate/35` are both border-color
  // utilities, so which one wins is decided by stylesheet position rather than
  // by the order they appear in the attribute. Passing it through would work
  // or not work depending on which colour Tailwind happened to emit last.
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-4 py-1.5',
        'font-display text-2xs font-medium tracking-widest uppercase',
        onDeep ? 'border-white/25 text-text-on-deep-muted' : 'border-slate/35 text-text-muted',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
