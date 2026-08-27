import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { hashPassword, writeCredential } from '../lib/credential.js';

/**
 * Applies `ADMIN_EMAIL` and `ADMIN_PASSWORD` to the operator account, and
 * touches nothing else.
 *
 * IT EXISTS BECAUSE `npm run seed` IS THE WRONG TOOL FOR THIS. The seed is
 * idempotent, which is exactly the problem: rerunning it restores jd_trader's
 * seeded holdings, orders and snapshots to the design's figures, so an operator
 * rotating a password would silently revert every trade made on that database.
 * Changing a credential must not be entangled with rebuilding fixtures.
 *
 * It is also the answer to a real gap. Before this, the only way to change the
 * admin password was to reseed — which on a production database is not a thing
 * anybody should be willing to do, so in practice the password could not be
 * rotated at all.
 *
 * SAFE TO RUN REPEATEDLY. Everything here is an upsert, and running it twice
 * with unchanged config produces the same document with a fresh bcrypt hash of
 * the same password.
 */

/** Keyed on the HANDLE, never the address — see the note in `seed.js`. */
const ADMIN_USERNAME = 'admin';

export async function syncAdmin({ log = console.log } = {}) {
  const email = env.ADMIN_EMAIL;

  /**
   * REFUSE IF THE ADDRESS BELONGS TO SOMEBODY ELSE, rather than promoting them.
   *
   * `User.email` is uniquely indexed, so pointing the operator at an address a
   * trader already holds would either die on E11000 or — if this were written
   * as a promotion instead — hand `role: 'admin'` to an existing account
   * because of a line in a config file. Granting administrator by environment
   * variable to an account somebody else registered is the quietest privilege
   * escalation available, and the same reasoning is why the user admin refuses
   * to make role editable from a table row.
   */
  const clash = await User.findOne({ email, username: { $ne: ADMIN_USERNAME } })
    .select('username role')
    .lean();

  if (clash) {
    throw new Error(
      `ADMIN_EMAIL (${email}) already belongs to "${clash.username}" (role: ${clash.role}). ` +
        'Refusing to reassign it. Use a different address, or remove that account first.',
    );
  }

  const before = await User.findOne({ username: ADMIN_USERNAME }).select('email').lean();

  const admin = await User.findOneAndUpdate(
    { username: ADMIN_USERNAME },
    {
      $set: {
        email,
        role: 'admin',
        // Suspending the only operator locks the product out of its own admin,
        // and this is the one command that can undo it.
        status: 'Active',
        // Better Auth's two required fields, matching what `seed.js` writes.
        name: ADMIN_USERNAME,
        emailVerified: true,
      },
      $setOnInsert: { cashBalanceCents: 0, createdAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await writeCredential(admin._id, await hashPassword(env.ADMIN_PASSWORD));

  /**
   * ROTATING THE PASSWORD MUST REVOKE THE SESSIONS, or it has not rotated
   * anything that matters.
   *
   * Better Auth sessions are ROWS, not self-contained tokens — a cookie stays
   * valid until its row is deleted, entirely independently of the password that
   * created it. So writing a new hash and stopping there leaves whoever was
   * signed in with the OLD password still signed in, on the one account that
   * reaches the admin section. That is the precise situation somebody rotates a
   * credential to end.
   *
   * `adminUser.service.js` does the same thing on suspension and for the same
   * stated reason: leaving the rows means the account is refused on the next
   * sign-in while a live session sits there working, which is two answers to
   * "is this person signed in".
   *
   * Deleting them is also what makes this command a RECOVERY tool — an operator
   * locked out, or one who thinks a session has been taken, can rotate and know
   * every existing cookie is dead.
   */
  const revoked = await mongoose.connection
    .collection('sessions')
    .deleteMany({ userId: admin._id });
  const sessionsRevoked = revoked.deletedCount ?? 0;

  const created = !before;
  const renamed = before && before.email !== email;

  log(
    created
      ? `  Created operator "${ADMIN_USERNAME}" <${email}>`
      : renamed
        ? `  Operator "${ADMIN_USERNAME}" moved ${before.email} -> ${email}`
        : `  Operator "${ADMIN_USERNAME}" <${email}> unchanged`,
  );
  // Never the value. This output gets scrolled through and screenshotted.
  log('  Password rewritten from ADMIN_PASSWORD.');
  log(
    sessionsRevoked
      ? `  Revoked ${sessionsRevoked} existing session(s) - sign in again.`
      : '  No existing sessions to revoke.',
  );

  return { userId: String(admin._id), email, created, renamed, sessionsRevoked };
}

/** Run directly: `npm run admin:sync`. */
if (import.meta.url === `file://${process.argv[1]}`) {
  await connectDb();
  try {
    console.log('\nSyncing the operator account from the environment:\n');
    await syncAdmin();
    console.log('');
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}
