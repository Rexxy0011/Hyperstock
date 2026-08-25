import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from './env.js';

let memoryServer = null;

/**
 * True when the connected deployment supports multi-document transactions.
 * Standalone mongod does not; Atlas M0 and a local replica set do.
 *
 * The order service is written so that the *guards* (conditional atomic
 * updates) are race-safe even without transactions — this flag only controls
 * whether the multi-write ledger update is additionally all-or-nothing.
 */
export let supportsTransactions = false;

/** True when running against the throwaway in-memory server (no MONGODB_URI). */
export const isEphemeral = () => memoryServer !== null;

async function resolveUri() {
  if (env.MONGODB_URI) return { uri: env.MONGODB_URI, ephemeral: false };

  // No URI configured: spin up an in-memory replica set so a fresh clone runs
  // with zero install. Data is discarded on shutdown.
  const { MongoMemoryReplSet } = await import('mongodb-memory-server').catch(() => {
    throw new Error(
      'MONGODB_URI is not set and mongodb-memory-server is not installed.\n' +
        'Either set MONGODB_URI in server/.env or run `npm install`.',
    );
  });

  console.log('  MONGODB_URI not set — starting in-memory MongoDB replica set…');
  memoryServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  return { uri: memoryServer.getUri(), ephemeral: true };
}

async function probeTransactions() {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await session.abortTransaction();
    return true;
  } catch {
    return false;
  } finally {
    await session.endSession();
  }
}

export async function connectDb() {
  const { uri, ephemeral } = await resolveUri();

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });

  supportsTransactions = await probeTransactions();

  const host = ephemeral ? 'in-memory replica set' : mongoose.connection.host;
  console.log(`  MongoDB connected: ${host} (db: ${mongoose.connection.name})`);

  // ORDER MATTERS: the backfill has to run before the index work, because it
  // is what makes the compound key well-defined for rows written before the
  // field existed.
  await backfillAssetClass();
  await backfillUnsubscribeTokens();
  await dropSupersededIndexes();

  if (supportsTransactions) {
    console.log('  Transactions: supported');
  } else {
    console.warn(
      '  Transactions: NOT supported (standalone mongod).\n' +
        '     Order writes fall back to compensating updates. The balance guards\n' +
        '     remain race-safe, but a mid-write crash could leave a partial ledger.\n' +
        '     Use Atlas M0 or a local replica set for full safety.',
    );
  }

  return mongoose.connection;
}

/**
 * Gives every pre-existing row the `assetClass` its schema now requires.
 *
 * A MONGOOSE `default` APPLIES ON CREATION, NEVER TO DOCUMENTS ALREADY STORED,
 * and that gap split a live position. The compound key is
 * `{userId, assetClass, symbol}`, so a holding written before the field existed
 * indexes as `(userId, null, 'AAPL')` while a new buy upserts on
 * `(userId, 'stocks', 'AAPL')` — different keys, no uniqueness violation, and
 * the account quietly ends up holding "12 AAPL" and "7 AAPL" as two separate
 * positions. Observed exactly that on the development database.
 *
 * So legacy rows are adopted, and where adopting one would collide with a row
 * that already carries the class, the two are MERGED rather than one being
 * dropped: both halves are real money the user paid, so shares and cost basis
 * are summed and the legacy row is removed. Anything else would either lose a
 * position or leave a permanent duplicate.
 *
 * Written to be a no-op once it has run, so it is safe on every boot.
 */
/**
 * Gives every subscriber row an unsubscribe token.
 *
 * A MONGOOSE `required` DOES NOT BACKFILL — the same lesson `assetClass` taught
 * on `Holding`, and the failure here is quieter. `Subscriber` gained the field
 * when the CTA became a newsletter subscription; a row written before that has
 * no token, so nothing identifies it and **that address can never leave the
 * list**, which is the exact liability the token was added to prevent. The
 * unique index would also reject a second row at `null` if the field were ever
 * defaulted rather than generated.
 *
 * Runs before the index work, and is a no-op once it has run.
 */
export async function backfillUnsubscribeTokens() {
  const subscribers = mongoose.connection.collection('subscribers');
  const legacy = await subscribers
    .find({ unsubscribeToken: { $exists: false } })
    .project({ _id: 1 })
    .toArray();
  if (legacy.length === 0) return;

  // One token per row, generated individually — a shared value would collide on
  // the unique index and, worse, let one link unsubscribe somebody else.
  await Promise.all(
    legacy.map((row) =>
      subscribers.updateOne(
        { _id: row._id },
        { $set: { unsubscribeToken: crypto.randomBytes(24).toString('base64url') } },
      ),
    ),
  );

  console.log(`  Backfilled unsubscribe tokens: ${legacy.length}`);
}

export async function backfillAssetClass() {
  const holdings = mongoose.connection.collection('holdings');
  const legacy = await holdings.find({ assetClass: { $exists: false } }).toArray();
  if (legacy.length === 0) {
    // Orders carry the field too. They have no unique key over it, so this is
    // a plain update with nothing to reconcile.
    await mongoose.connection
      .collection('orders')
      .updateMany({ assetClass: { $exists: false } }, { $set: { assetClass: 'stocks' } })
      .catch(() => {});
    return;
  }

  let adopted = 0;
  let merged = 0;

  for (const row of legacy) {
    const twin = await holdings.findOne({
      userId: row.userId,
      assetClass: 'stocks',
      symbol: row.symbol,
      _id: { $ne: row._id },
    });

    if (twin) {
      await holdings.updateOne(
        { _id: twin._id },
        { $inc: { shares: row.shares, costBasisCents: row.costBasisCents } },
      );
      await holdings.deleteOne({ _id: row._id });
      merged += 1;
    } else {
      await holdings.updateOne({ _id: row._id }, { $set: { assetClass: 'stocks' } });
      adopted += 1;
    }
  }

  await mongoose.connection
    .collection('orders')
    .updateMany({ assetClass: { $exists: false } }, { $set: { assetClass: 'stocks' } })
    .catch(() => {});

  console.log(
    `  Backfilled assetClass on ${adopted + merged} holdings` +
      (merged ? ` (${merged} merged into an existing position)` : ''),
  );
}

/**
 * Indexes a schema change has superseded but Mongoose will never remove.
 *
 * `autoIndex` creates what the schema declares and stops there — it does not
 * drop what the schema no longer declares, and `syncIndexes()` (which would)
 * is too blunt to run at boot against a database it does not own.
 *
 * The one entry here matters. `holdings` used to be unique on
 * `{userId, symbol}`, which is not just narrower than the compound key that
 * replaced it: left in place it REFUSES a second position in a symbol that
 * legitimately exists in two asset classes, and the failure would surface as an
 * E11000 on an unrelated buy rather than as anything pointing here.
 *
 * Written to be a no-op on a database that has already been migrated and on a
 * fresh one that never had the index, so it is safe on every boot.
 */
async function dropSupersededIndexes() {
  /** @type {[string, string][]} */
  const superseded = [['holdings', 'userId_1_symbol_1']];

  for (const [collection, index] of superseded) {
    try {
      const coll = mongoose.connection.collection(collection);
      const existing = await coll.indexes();
      if (!existing.some((i) => i.name === index)) continue;
      await coll.dropIndex(index);
      console.log(`  Dropped superseded index ${collection}.${index}`);
    } catch (err) {
      // NamespaceNotFound (26) on a fresh database is expected, not a problem.
      if (err?.code !== 26) {
        console.warn(`  Could not drop ${collection}.${index}: ${err.message}`);
      }
    }
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

/**
 * Runs `fn(session)` inside a transaction when the deployment supports one,
 * and plainly otherwise. Callers must not depend on rollback for correctness —
 * see the guard pattern in services/order.service.js.
 */
export async function withTransaction(fn) {
  if (!supportsTransactions) return fn(null);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
