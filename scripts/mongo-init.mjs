/**
 * Initiates the local single-node replica set, idempotently.
 *
 * There is no `mongosh` on this machine, so this drives the `mongodb` driver
 * that is already a dependency instead of shelling out to a client.
 *
 * A fresh --replSet mongod is LISTENING BUT UNWRITEABLE until `replSetInitiate`
 * runs, and the error it gives before that ("not primary") looks like a
 * connection problem rather than a setup step — so this runs as part of
 * `mongo.sh start` rather than being left as a thing to remember.
 */
import { MongoClient } from 'mongodb';

const PORT = 27017;
const REPL_SET = 'rs0';
const HOST = `127.0.0.1:${PORT}`;

/** `directConnection` is required: without it the driver performs replica-set
 *  discovery, finds no primary on an uninitiated set, and simply hangs. */
const client = new MongoClient(`mongodb://${HOST}/?directConnection=true`, {
  serverSelectionTimeoutMS: 10_000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await client.connect();
  const admin = client.db('admin');

  let alreadyInitiated = false;
  try {
    await admin.command({ replSetGetStatus: 1 });
    alreadyInitiated = true;
  } catch (err) {
    // 94 = NotYetInitialized. Anything else is a real failure worth surfacing.
    if (err.code !== 94 && !/no replset config/i.test(err.message)) throw err;
  }

  if (alreadyInitiated) {
    console.log('  replica set already initiated');
  } else {
    await admin.command({
      replSetInitiate: { _id: REPL_SET, members: [{ _id: 0, host: HOST }] },
    });
    console.log('  replica set initiated');
  }

  // Election takes a moment even for a single node, and a write issued before
  // it completes fails with "not primary" — which reads as a broken database
  // rather than a race, so it is waited out here instead of by the caller.
  for (let i = 0; i < 40; i++) {
    const status = await admin.command({ replSetGetStatus: 1 });
    // 1 = PRIMARY
    if (status.members?.some((m) => m.state === 1)) {
      console.log(`  primary ready on ${HOST}`);
      break;
    }
    await sleep(250);
  }
} catch (err) {
  console.error(`  replica set init failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
