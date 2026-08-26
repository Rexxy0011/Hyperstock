import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
      match: [/^[a-z0-9_]+$/i, 'Username may only contain letters, numbers and underscores'],
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    /**
     * Human-readable name, shown wherever a person is presented rather than
     * addressed. `username` is a handle and is regex-constrained to URL-safe
     * characters, so it cannot hold spaces, capitals or accents; this can.
     * Optional — the UI falls back to `username`.
     */
    displayName: { type: String, trim: true, maxlength: 60 },

    /**
     * BETTER AUTH'S OWN THREE FIELDS, declared here so the two writers of this
     * collection agree on its shape. Better Auth goes through the native driver
     * and would write them regardless; a Mongoose schema that does not know
     * them simply drops them from every document it hydrates, so `emailVerified`
     * would read as undefined on the exact path that checks it.
     *
     * `name` is Better Auth's required display field. It is NOT `username` —
     * that is the handle, owned by the username plugin — and it is not
     * `displayName` either, which this product had first and still uses.
     */
    name: { type: String, trim: true, maxlength: 120 },
    emailVerified: { type: Boolean, default: false },
    image: { type: String },

    /**
     * CREDENTIALS ARE NOT HERE ANY MORE. Better Auth keeps them in `accounts`,
     * one row per sign-in method, which is what makes a user row with no
     * credential a coherent thing — and that is exactly what the 207 seeded
     * leaderboard traders are. They rank, they hold positions, and there is no
     * password to present because no `accounts` row exists.
     *
     * The field is kept, optional and still `select: false`, only so documents
     * written before the migration do not lose data on their next save. Nothing
     * reads it; `auth/betterAuth.js` verifies against `accounts.password`.
     */
    passwordHash: { type: String, select: false },

    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    status: { type: String, enum: ['Active', 'Flagged', 'Suspended'], default: 'Active' },

    /**
     * Virtual USD cash in integer cents. Seeded at signup; only the order and
     * wallet services move it. Never a float — see lib/money.js.
     */
    cashBalanceCents: {
      type: Number,
      required: true,
      default: 1_000_000,
      min: 0,
      validate: { validator: Number.isInteger, message: 'cashBalanceCents must be an integer' },
    },

    /** Denormalised so the leaderboard doesn't need a second aggregation. */
    tradeCount: { type: Number, default: 0, min: 0 },

    /* The watchlist is the WatchlistItem collection, not a field here. A bare
       symbol cannot identify a crypto or forex row, so the entry has to carry
       its asset class — and once it is a pair, the unique index on that
       collection is what makes a double-add a no-op. */

    /** Bumped to invalidate every outstanding refresh token for this user. */
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.index({ status: 1, role: 1 });

/** The design derives avatars from the username's first letter, in one place. */
userSchema.virtual('avatarLetter').get(function () {
  return this.username?.[0]?.toUpperCase() ?? '?';
});

userSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, /** @type {any} */ ret) {
    delete ret.passwordHash;
    delete ret.__v;
    delete ret.tokenVersion;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
