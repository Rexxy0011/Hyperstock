import mongoose from 'mongoose';

/**
 * Refresh tokens are stored hashed and rotated on every use, so a session can
 * be revoked server-side and token reuse is detectable. A reused token means
 * the cookie leaked — we revoke the whole family rather than just that token.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    /** SHA-256 of the token — the raw value only ever lives in the cookie. */
    tokenHash: { type: String, required: true, unique: true },

    /** Shared by every token descended from one login, for family revocation. */
    familyId: { type: String, required: true },

    revokedAt: { type: Date },
    replacedByHash: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ userId: 1, familyId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
