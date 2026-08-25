import mongoose from 'mongoose';

/**
 * An address captured by a marketing call to action.
 *
 * WHY IT IS A COLLECTION AND NOT A THIRD-PARTY FORM SERVICE. The alternative
 * considered was posting straight to EmailJS or Basin from the browser. EmailJS
 * ships its service id, template id and public key in the JS bundle, so anyone
 * can lift them and send through the account's own template and quota — the
 * domain allowlist is an `Origin` check and `curl` does not send one. Both keep
 * the addresses somewhere this product cannot read them, which matters here
 * because there is already an Express API, a Mongo instance and an admin shell:
 * a third-party form backend is the answer for a static site, and this is not
 * one.
 *
 * NOT A USER. Someone who leaves an address on the landing page has not signed
 * up, has no balance and cannot log in — putting them in `User` would break
 * every count that assumes a user is a trader, the leaderboard's `$match` on
 * `role: 'user'` included.
 */
const subscriberSchema = new mongoose.Schema(
  {
    /**
     * Lower-cased and trimmed on the way in, and UNIQUE — so submitting the
     * same address twice is a no-op rather than a second row. The uniqueness
     * lives in the index rather than a preceding `findOne`, which is the same
     * rule the order ledger and the deposit `txHash` follow: a read-then-write
     * loses the race that a double-tapped button actually creates.
     */
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    /**
     * Which call to action produced it. Kept because "the landing hero converts
     * and the FAQ footer does not" is the only interesting question about this
     * collection, and it cannot be answered retrospectively.
     */
    source: {
      type: String,
      enum: ['landing_cta', 'faq_cta', 'footer', 'other'],
      default: 'other',
      index: true,
    },

    /** Set once the address belongs to a registered account. */
    converted: { type: Boolean, default: false },

    /**
     * A LIST YOU CANNOT LEAVE IS NOT A NEWSLETTER LIST, it is a liability. This
     * became a subscription rather than a signup capture, and the moment
     * anything is actually sent to these addresses an unsubscribe path stops
     * being optional — so the field and its token exist from the start rather
     * than being retrofitted onto rows that never had one.
     *
     * A TOKEN, NOT THE EMAIL. An endpoint that unsubscribes whatever address it
     * is handed lets anyone remove anyone, and — worse — confirms whether an
     * address is on the list, which is the same oracle the subscribe endpoint
     * goes out of its way not to be.
     */
    unsubscribeToken: { type: String, required: true, unique: true, index: true },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

subscriberSchema.index({ createdAt: -1 });

export const Subscriber = mongoose.model('Subscriber', subscriberSchema);
