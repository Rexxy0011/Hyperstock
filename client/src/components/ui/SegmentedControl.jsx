/**
 * Ported from the design system's components/forms/SegmentedControl.jsx.
 * Used for Sign in/Create account, Buy/Sell, Market/Limit, and the admin
 * status filters.
 */
export default function SegmentedControl({ options, value, onChange, size = 'md', className = '' }) {
  const pad = size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-base';

  return (
    <div
      role="tablist"
      className={`inline-flex rounded-md border border-cool-grey bg-mist p-0.5 ${className}`}
    >
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        const active = val === value;

        return (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(val)}
            className={[
              'rounded-md font-medium transition-colors cursor-pointer',
              pad,
              active
                ? 'bg-white text-void shadow-card'
                : 'bg-transparent text-text-muted hover:text-text-body',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
