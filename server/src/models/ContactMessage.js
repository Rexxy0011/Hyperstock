import mongoose from 'mongoose';

/**
 * A message left on the contact form.
 *
 * IT IS A ROW BECAUSE THE ALTERNATIVE IS A FORM THAT SWALLOWS ENQUIRIES. This
 * repo already made this exact decision once, for the newsletter capture, and
 * the reasoning transfers without modification: EmailJS ships its credentials
 * in the JS bundle and keeps no record, so a failed send is a lost enquiry;
 * Basin stores submissions but somewhere this product cannot read them. Both
 * are the right answer for a static site. There is an Express API, a Mongo
 * instance and an admin shell here, so a contact form that posts anywhere else
 * is choosing to lose messages.
 *
 * IT IS ALSO WHY THERE IS NO SENDER IN THE PATH. `lib/mailer.js` exists, but
 * `hyperstocks.app` has no MX record and is not controlled by this project, so
 * Resend cannot verify the domain and delivery is restricted to the account
 * owner's own address. A notification email would therefore be the unreliable
 * half of the feature. The row is the durable half, and `/soap/messages` is
 * where it is read.
 *
 * NOT A `User`, and not a `Subscriber` either. Somebody who asks a question has
 * not signed up and has not joined a mailing list — folding them into either
 * would put a one-off enquiry into a count that means something else. A sender
 * may well be both; the address is stored plainly so the admin screen can say
 * so without this collection needing to know.
 */
const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    /**
     * Lower-cased and trimmed like `Subscriber.email`, so the same person
     * writing twice from `Ada@…` and `ada@…` is visibly one person in the
     * queue.
     *
     * DELIBERATELY NOT UNIQUE. A subscriber is a membership and a second insert
     * is a duplicate; a message is an EVENT, and somebody with two questions has
     * two messages. A unique index here would silently discard the second one.
     */
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },

    /** Optional: the reference form asks for it, and most people leave it. */
    phone: { type: String, trim: true, maxlength: 40, default: '' },

    /**
     * What the enquiry is about, so the queue can be triaged without opening
     * every message.
     *
     * An ENUM rather than free text, and the values are this product's own
     * surfaces rather than the reference's service list — "Web Design" and "SEO"
     * describe an agency, and a topic nobody can act on is worse than no topic.
     * `other` is a real choice, not a fallback: a picker that cannot express
     * "none of these" makes everybody pick something wrong.
     */
    topic: {
      type: String,
      enum: ['account', 'funding', 'trading', 'partnership', 'other'],
      default: 'other',
      index: true,
    },

    message: { type: String, required: true, trim: true, maxlength: 4000 },

    /**
     * Set when an operator has dealt with it. A message with no state is a queue
     * that only grows, and the one question the screen has to answer is which
     * ones still need somebody.
     */
    handledAt: { type: Date, default: null },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

/** The queue reads newest-first, and filters on what is still outstanding. */
contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ handledAt: 1, createdAt: -1 });

export const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
