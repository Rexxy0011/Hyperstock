import crypto from "node:crypto";
import { Subscriber } from "../models/Subscriber.js";
import { User } from "../models/User.js";

/**
 * Capturing an address from a marketing call to action.
 *
 * THE RESPONSE IS THE SAME WHETHER OR NOT THE ADDRESS IS ALREADY KNOWN, and
 * that is deliberate rather than lazy. An endpoint that answers "already
 * subscribed" is an unauthenticated oracle for whether a given address is on
 * this platform — free to ask, and the sort of thing that gets fed a word list.
 * The caller gets `{ ok: true }` either way; `created` is returned alongside so
 * the SERVER can distinguish the two for its own counting without the
 * distinction reaching an anonymous client.
 */
export async function subscribe({ email, source = "other" }) {
  const address = String(email ?? "")
    .trim()
    .toLowerCase();

  // Shape only. Deliverability is not knowable here, and a stricter pattern
  // rejects valid addresses far more often than it catches a bad one.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address) || address.length > 254) {
    return { ok: false, code: "BAD_EMAIL" };
  }

  /**
   * Upsert, not find-then-create. Two submissions racing — a double-tapped
   * button is exactly that — would both find nothing and both insert, and one
   * would then die on the unique index with a 500 for a form that worked.
   *
   * `$setOnInsert` for `source`, so the FIRST call to action that captured an
   * address keeps the credit; overwriting it on a later submit would quietly
   * reattribute every conversion to whichever page someone visited last.
   */
  const before = await Subscriber.findOne({ email: address })
    .select("_id")
    .lean();

  await Subscriber.updateOne(
    { email: address },
    {
      $setOnInsert: {
        email: address,
        source,
        unsubscribeToken: crypto.randomBytes(24).toString("base64url"),
      },
      /**
       * CLEARED on every submit, and it must be `$set` rather than
       * `$setOnInsert`. Someone who left the list and later fills the form again
       * is giving consent a second time — leaving `unsubscribedAt` in place
       * would silently drop that submission on the floor and show them a
       * confirmation for a subscription that did not happen.
       */
      $set: { unsubscribedAt: null },
    },
    { upsert: true }
  );

  return { ok: true, created: !before };
}

/**
 * Leaving the list.
 *
 * KEYED ON THE TOKEN. Taking an email address here would let anyone unsubscribe
 * anyone, and would answer "is this address on your list" for free — the same
 * oracle `subscribe()` is careful not to be. A token nobody can guess is the
 * only input that identifies a row without disclosing anything.
 *
 * The response is the same for an unknown token as for a successful one, for
 * that reason. It is also idempotent: unsubscribing twice is the outcome the
 * caller asked for both times, and a second click on an old mail should not
 * produce an error page.
 */
export async function unsubscribe(token) {
  const value = String(token ?? "").trim();
  if (!value) return { ok: false, code: "BAD_TOKEN" };

  await Subscriber.updateOne(
    { unsubscribeToken: value, unsubscribedAt: null },
    { $set: { unsubscribedAt: new Date() } }
  );

  return { ok: true };
}

/**
 * The admin listing.
 *
 * `converted` is computed at read time rather than maintained on the row: it is
 * one indexed lookup over the addresses on this page, and a stored flag would
 * need a writer on the registration path that nobody would remember to add.
 */
export async function listSubscribers({ limit = 100 } = {}) {
  const rows = await Subscriber.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .lean();

  if (!rows.length) return [];

  const registered = new Set(
    (
      await User.find({ email: { $in: rows.map((r) => r.email) } })
        .select("email")
        .lean()
    ).map((u) => String(u.email).toLowerCase())
  );

  return rows.map((r) => ({
    id: String(r._id),
    email: r.email,
    source: r.source,
    converted: registered.has(r.email),
    subscribed: !r.unsubscribedAt,
    unsubscribedAt: r.unsubscribedAt ?? null,
    createdAt: r.createdAt,
    // NOT the token. It is the only credential on this row, and an admin
    // listing has no use for it that is worth putting it on the wire.
  }));
}

export async function subscriberCounts() {
  const [total, subscribed, convertedAgg] = await Promise.all([
    Subscriber.countDocuments(),
    // The number that matters for a send. `total` includes people who left, and
    // reporting that as the list size overstates it every time.
    Subscriber.countDocuments({ unsubscribedAt: null }),
    // Push the join to MongoDB rather than loading every user into Node memory.
    Subscriber.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "email",
          foreignField: "email",
          as: "_u",
        },
      },
      { $match: { "_u.0": { $exists: true } } },
      { $count: "n" },
    ]),
  ]);

  return { total, subscribed, converted: convertedAgg[0]?.n ?? 0 };
}
