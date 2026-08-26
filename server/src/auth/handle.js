import crypto from 'node:crypto';
import { User } from '../models/User.js';

/**
 * Invents a username for an account that arrives without one.
 *
 * GOOGLE HANDS BACK A NAME, AN EMAIL AND A PICTURE — NEVER A HANDLE. This
 * product requires one on every user: it is regex-constrained to `^[a-z0-9_]+$`
 * because it appears in URLs, it drives `lib/monogram.js` and `investorPhoto()`,
 * and it carries a unique index. So a social signup has to be given one, and
 * the alternative — a second screen asking the new user to pick a handle — puts
 * a form between somebody and the account they just consented to create.
 *
 * `user_` IS NOT THE FALLBACK PREFIX BY ACCIDENT. The seed's synthetic traders
 * are `trader_NNN`, and that namespace is exactly what `/admin/users` uses to
 * separate fixtures from real accounts. Minting a real person as `trader_0428`
 * would blur the one distinction that screen exists to make.
 */

const MIN = 3;
const MAX = 24;

/** How many predictable suffixes to try before giving up on readability. */
const DETERMINISTIC_TRIES = 20;

/**
 * Reduces an email local part or display name to something the handle rule
 * accepts. Runs of illegal characters collapse to one underscore rather than
 * one each, so "Ada  Lovelace-King" is `ada_lovelace_king`, not
 * `ada__lovelace_king`.
 */
export function baseHandle(seed) {
  const cleaned = String(seed ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks, so "José" becomes "jose" rather than "jos_".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX - 4); // leaves room for a numeric suffix

  return cleaned.length >= MIN ? cleaned : '';
}

/**
 * Resolves a free handle, checking the database.
 *
 * Deterministic suffixes first, because `ada_2` is a handle somebody will
 * recognise as theirs and `ada_k3f9x1` is not. After twenty of those the name
 * is clearly contested and readability has stopped being the point, so it falls
 * back to random — which also narrows the race window below, since two
 * simultaneous signups are far less likely to draw the same random suffix than
 * the same next integer.
 *
 * THIS IS CHECK-THEN-INSERT AND THEREFORE RACY, and the unique index is what
 * actually guarantees correctness — two concurrent signups can both see `ada`
 * free. The loser gets an E11000 rather than a duplicate, which is the right
 * way round; this function exists to make that collision rare, not to prevent
 * it.
 *
 * @param {{ email?: string, name?: string }} profile
 */
export async function uniqueHandle(profile) {
  const base =
    baseHandle(String(profile?.email ?? '').split('@')[0]) ||
    baseHandle(profile?.name) ||
    'user';

  if (!(await User.exists({ username: base }))) return base;

  for (let n = 2; n <= DETERMINISTIC_TRIES; n += 1) {
    const candidate = `${base}_${n}`.slice(0, MAX);
    if (!(await User.exists({ username: candidate }))) return candidate;
  }

  // Six hex characters over a contested base. Collision here means the same
  // base AND the same suffix, which the unique index would still catch.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}_${crypto.randomBytes(3).toString('hex')}`.slice(0, MAX);
    if (!(await User.exists({ username: candidate }))) return candidate;
  }

  throw new Error('could not allocate a username');
}
