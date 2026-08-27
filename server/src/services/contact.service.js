import { ContactMessage } from '../models/ContactMessage.js';
import { User } from '../models/User.js';

/**
 * Taking a message from the contact form, and reading the queue it fills.
 *
 * THE RESPONSE SAYS NOTHING ABOUT THE SENDER, which is the same rule
 * `subscriber.service.js` follows and for the same reason. This endpoint is
 * public and unauthenticated, so any difference in what it answers for a known
 * address versus an unknown one turns it into a free oracle for who holds an
 * account here. It returns `{ ok: true }` and the id it wrote, and nothing that
 * varies with who is asking.
 */

/** Shape only. Deliverability is not knowable here — see `subscribe()`. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Records a message.
 *
 * NO UPSERT AND NO IDEMPOTENCY KEY, and both absences are deliberate. A double
 * tap writes two rows, and that is the correct outcome for this collection: the
 * alternative is deciding that two messages with the same body are the same
 * message, which silently discards a genuine follow-up. Duplicates are cheap
 * here and cost an operator one glance; a dropped enquiry costs a customer.
 */
export async function submitMessage({ name, email, phone, topic, message }) {
  const address = String(email ?? '')
    .trim()
    .toLowerCase();

  if (!EMAIL.test(address) || address.length > 254) {
    return { ok: false, code: 'BAD_EMAIL' };
  }

  const body = String(message ?? '').trim();
  // A length floor rather than a mere presence check: a single character passes
  // `required` and is not a message. Low enough that a terse real question
  // ("Where are my funds?") clears it comfortably.
  if (body.length < 10) {
    return { ok: false, code: 'MESSAGE_TOO_SHORT' };
  }

  const sender = String(name ?? '').trim();
  if (!sender) return { ok: false, code: 'NAME_REQUIRED' };

  const doc = await ContactMessage.create({
    name: sender,
    email: address,
    phone: String(phone ?? '').trim(),
    topic: topic ?? 'other',
    message: body,
  });

  return { ok: true, id: String(doc._id) };
}

/**
 * The admin queue.
 *
 * `registered` is computed against `User.email` on every read rather than
 * stored, exactly as `converted` is on the subscriber listing: a stored flag
 * needs a writer on the signup path, and that writer is what nobody remembers
 * to add. It is worth having because "is this a customer or a stranger" changes
 * how a message gets answered, and nothing else on the row says.
 */
export async function listMessages({ limit = 100 } = {}) {
  const rows = await ContactMessage.find()
    // Outstanding first, then newest — the screen exists to show what still
    // needs somebody, and a handled message from an hour ago is not that.
    .sort({ handledAt: 1, createdAt: -1 })
    .limit(Math.min(500, Math.max(1, limit)))
    .lean();

  if (!rows.length) return [];

  const registered = new Set(
    (
      await User.find({ email: { $in: rows.map((r) => r.email) } })
        .select('email')
        .lean()
    ).map((u) => String(u.email).toLowerCase()),
  );

  return rows.map((r) => ({
    id: String(r._id),
    name: r.name,
    email: r.email,
    phone: r.phone ?? '',
    topic: r.topic,
    message: r.message,
    registered: registered.has(r.email),
    handled: Boolean(r.handledAt),
    handledAt: r.handledAt ?? null,
    createdAt: r.createdAt,
  }));
}

export async function messageCounts() {
  const [total, outstanding] = await Promise.all([
    ContactMessage.countDocuments(),
    ContactMessage.countDocuments({ handledAt: null }),
  ]);
  return { total, outstanding };
}

/**
 * Marks a message dealt with, or puts it back.
 *
 * THE EXPECTED STATE IS IN THE FILTER, so two operators clearing the same
 * message do not both succeed — the loser matches no document and gets
 * `{ changed: false }`. Same shape as every other compare-and-set in this
 * codebase; the consequence is milder here than on a withdrawal, but the
 * alternative is `handledBy` recording whoever pressed the button last rather
 * than whoever actually did the work.
 */
export async function setHandled(id, handled, adminId) {
  const filter = handled
    ? { _id: id, handledAt: null }
    : { _id: id, handledAt: { $ne: null } };

  const update = handled
    ? { $set: { handledAt: new Date(), handledBy: adminId } }
    : { $set: { handledAt: null, handledBy: null } };

  const result = await ContactMessage.updateOne(filter, update);
  return { changed: (result.modifiedCount ?? 0) > 0, handled };
}
