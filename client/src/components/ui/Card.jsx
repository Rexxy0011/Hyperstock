/**
 * The white panel used across every screen. One radius, one shadow — the
 * design system permits no others, and the Tailwind theme removes the rest.
 */
export default function Card({ label = undefined, muted = false, className = '', children, ...rest }) {
  return (
    <div
      className={[
        'rounded-md border border-cool-grey p-5',
        muted ? 'bg-mist' : 'bg-white shadow-card',
        className,
      ].join(' ')}
      {...rest}
    >
      {label && <div className="mb-3 text-xs text-text-muted">{label}</div>}
      {children}
    </div>
  );
}

/** The mist frame each product screenshot sits inside on the Landing page. */
export function Showcase({ className = '', children }) {
  return (
    <div className={`rounded-md border border-cool-grey bg-mist p-6 ${className}`}>{children}</div>
  );
}
