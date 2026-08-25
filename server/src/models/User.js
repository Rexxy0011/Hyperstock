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

    // Never returned by default — every read must opt in explicitly.
    passwordHash: { type: String, required: true, select: false },

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
