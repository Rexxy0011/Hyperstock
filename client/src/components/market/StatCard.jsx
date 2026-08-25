import { pct } from '../../lib/format';

/** The four headline figures across the top of the dashboard. */
export default function StatCard({
  label,
  value,
  changePct = undefined,
  sub = undefined,
  loading = false,
}) {
  if (loading) return <div className="h-[92px] animate-pulse rounded-xl bg-hover" />;

  return (
    <div className="rounded-xl border border-cool-grey p-4">
      <div className="text-2xs text-text-muted">{label}</div>
      <div className="mt-1.5 font-numeric text-lg font-bold tracking-[-0.01em] tabular-nums text-void">
        {value}
      </div>
      {(changePct !== undefined || sub) && (
        <div className="mt-1.5 flex items-center gap-2">
          {changePct !== undefined && (
            <span
              className={`rounded-md px-1.5 py-0.5 font-numeric text-2xs font-semibold tabular-nums ${
                changePct >= 0 ? 'bg-green-tint text-gain' : 'bg-red-tint text-loss'
              }`}
            >
              {pct(changePct)}
            </span>
          )}
          {sub && <span className="text-2xs text-text-muted">{sub}</span>}
        </div>
      )}
    </div>
  );
}
