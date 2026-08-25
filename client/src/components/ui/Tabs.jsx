/**
 * Ported from the design system's components/forms/Tabs.jsx.
 * Used for chart timeframes (1D 1W 1M 3M 1Y All) and leaderboard periods.
 */
/**
 * `onDark` is a prop rather than a className because the active pill's
 * background and the resting text colour must change together — passing one
 * through `className` would leave `bg-mist` winning on an ink surface, since
 * Tailwind resolves conflicts by stylesheet position and not attribute order.
 */
export default function Tabs({
  tabs,
  value,
  onChange,
  numeric = false,
  onDark = false,
  className = '',
}) {
  return (
    <div role="tablist" className={`flex gap-1 ${className}`}>
      {tabs.map((tab) => {
        const val = typeof tab === 'string' ? tab : tab.value;
        const label = typeof tab === 'string' ? tab : tab.label;
        const active = val === value;

        return (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(val)}
            className={[
              'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              numeric ? 'font-numeric tabular-nums' : '',
              onDark
                ? active
                  ? 'bg-white/15 text-text-on-deep'
                  : 'text-text-on-deep-muted hover:text-text-on-deep'
                : active
                  ? 'bg-mist text-void'
                  : 'text-text-muted hover:text-text-body',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
