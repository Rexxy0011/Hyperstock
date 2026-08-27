import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Writing a password credential the way Better Auth writes one.
 *
 * EXTRACTED SO THERE IS ONE OWNER OF THE ROW SHAPE. `seed.js` built this inline
 * and `syncAdmin.js` needs exactly the same thing; two copies of it is the
 * failure this codebase keeps writing notes about, and here it has a
 * particularly nasty symptom — a row that is CLOSE but not identical does not
 * error, it fails at sign-in, which reads as a wrong password rather than as a
 * malformed document.
 *
 * `issuer`, `accountId` and the ObjectId `userId` were captured off a real
 * signup rather than guessed, for the same reason.
 */

/**
 * Cost 12 for anything written today.
 *
 * Legacy seeded hashes are cost 10 and are NOT invalidated by this: bcrypt
 * encodes its cost in the hash itself, so the two coexist and an old password
 * keeps verifying.
 */
export const hashPassword = (plaintext) => bcrypt.hash(String(plaintext), 12);

/**
 * Upserts the `credential` account row for a user.
 *
 * @param {mongoose.Types.ObjectId} userId
 * @param {string} passwordHash already hashed — this function never sees a
 *   plaintext, so a caller cannot accidentally store one.
 */
export async function writeCredential(userId, passwordHash) {
  const now = new Date();
  await mongoose.connection.collection('accounts').updateOne(
    { userId, providerId: 'credential' },
    {
      $set: {
        issuer: 'local:credential',
        accountId: String(userId),
        providerId: 'credential',
        userId,
        password: passwordHash,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}
