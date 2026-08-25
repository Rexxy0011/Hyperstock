/**
 * Ported from the design system's components/core/Badge.jsx.
 * Variants cover every status enum in the product: Listed/Halted,
 * Pending/Filled/Approved/Declined, and the leaderboard's "You" marker.
 */
const VARIANTS = {
  neutral: 'bg-mist text-text-muted border-cool-grey',
  approved: 'bg-green-tint text-gain border-transparent',
  declined: 'bg-red-tint text-loss border-transparent',
  exchange: 'bg-mist text-text-muted border-cool-grey font-mono',
  amber: 'bg-amber-tint text-amber border-transparent',
};

/** Maps the product's status strings onto badge variants in one place. */
export const statusVariant = (status) =>
  ({
    Listed: 'approved',
    Halted: 'declined',
    Filled: 'approved',
    Approved: 'approved',
    Declined: 'declined',
    Pending: 'neutral',
    Active: 'approved',
    Flagged: 'neutral',
    Suspended: 'declined',
    Live: 'approved',
    Sent: 'neutral',
    Draft: 'neutral',
    // The deposit and withdrawal machines are lower-case and snake-cased. They
    // belong in the same map rather than a second one in the admin screen —
    // this function is the single owner of status→colour, and a queue showing
    // every state in the same grey is a queue you cannot scan.
    awaiting_payment: 'neutral',
    payment_detected: 'amber',
    under_review: 'amber',
    requested: 'amber',
    approved: 'approved',
    rejected: 'declined',
    cancelled: 'neutral',
    expired: 'neutral',
  })[status] ?? 'neutral';

export default function Badge({ variant = 'neutral', className = '', children }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        VARIANTS[variant] ?? VARIANTS.neutral,
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
