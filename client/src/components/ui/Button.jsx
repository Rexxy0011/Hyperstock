import Link from './Link';

/**
 * Ported from the design system's components/core/Button.jsx.
 * Sizes and variants match the source exactly; hover/press states move from
 * React state to CSS pseudo-classes, which is why they also work on touch.
 */

const SIZES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-7 py-3.5 text-md',
};

const VARIANTS = {
  primary:
    'bg-gain text-white border border-transparent hover:bg-green-hover active:bg-green-press',
  secondary:
    'bg-white text-void border border-cool-grey hover:bg-mist active:bg-mist',
  ghost: 'bg-transparent text-void border border-transparent hover:bg-mist active:bg-mist',
  slate:
    'bg-slate text-white border border-transparent hover:bg-slate-hover active:bg-slate-press',
  'outline-green':
    'bg-transparent text-gain border border-gain hover:bg-green-tint active:bg-green-tint',
  'outline-red':
    'bg-transparent text-loss border border-loss hover:bg-red-tint active:bg-red-tint',
};

/**
 * Deep-surface counterparts, for the instrument terminal and the dark sections.
 *
 * Only the variants carrying a LIGHT BACKGROUND need one. `secondary` is
 * `bg-white text-void`, built for the white app canvas — dropped onto ink and
 * dimmed by the disabled rule it composites to a mid-grey slab with near-black
 * text at **4.45:1**, on a bar where everything else is transparent or bright
 * green. It reads as an artefact rather than a control, which is how a disabled
 * Trade button on `/crypto/BTC` came to look like no Trade button at all.
 *
 * A prop rather than a className for the reason `pill` is: `bg-white` and
 * `border-cool-grey` would win over anything passed in, because Tailwind
 * resolves conflicts by position in the generated stylesheet and not by order
 * in the attribute. `primary` is absent deliberately — the gain green already
 * reads on ink and a second definition would be a second owner of it.
 */
const DARK_VARIANTS = {
  secondary:
    'bg-white/10 text-text-on-deep border border-white/20 hover:bg-white/15 active:bg-white/20',
  ghost:
    'bg-transparent text-text-on-deep border border-transparent hover:bg-white/10 active:bg-white/15',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  pill = false,
  onDark = false,
  to = undefined,
  href = undefined,
  className = '',
  disabled = false,
  loading = false,
  children,
  ...rest
}) {
  // The radius has to be decided here, not passed through `className`. Tailwind
  // resolves conflicting utilities by their order in the generated stylesheet,
  // and `.rounded-md` is emitted after `.rounded-full` — so a `rounded-full` on
  // the call site loses silently and the button still renders at 8px.
  const classes = [
    'inline-flex items-center justify-center gap-2 font-semibold',
    pill ? 'rounded-full' : 'rounded-md',
    'transition-colors duration-150 cursor-pointer no-underline',
    // 45% is right over white and wrong over ink: the label there is LIGHT on a
    // dark fill, so the same dimming pushes it toward the background instead of
    // away from it. 60% holds the disabled state at 5.3:1 and still reads as
    // unavailable.
    onDark ? 'disabled:opacity-60' : 'disabled:opacity-45',
    'disabled:cursor-default disabled:pointer-events-none',
    SIZES[size],
    (onDark && DARK_VARIANTS[variant]) || VARIANTS[variant],
    className,
  ].join(' ');

  const content = loading ? (
    <>
      <Spinner />
      {children}
    </>
  ) : (
    children
  );

  // Anchors and router links get the same skin — a <button> inside an <a> is
  // invalid HTML, which is what the original mockup did.
  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    );
  }

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {content}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="size-3.5 animate-spin" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
