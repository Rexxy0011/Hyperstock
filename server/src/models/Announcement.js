import mongoose from 'mongoose';

/**
 * Modelled this pass, authored by the admin UI in the next one. The user-facing
 * banner reads `status: 'Live'` via GET /api/announcements/active.
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 600 },

    audience: {
      type: String,
      enum: ['All users', 'Active traders'],
      default: 'All users',
      required: true,
    },

    status: {
      type: String,
      enum: ['Draft', 'Live', 'Sent', 'Archived'],
      default: 'Draft',
      required: true,
      index: true,
    },

    deliveredCount: { type: Number, default: 0 },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

announcementSchema.set('toJSON', {
  transform(_doc, /** @type {any} */ ret) {
    delete ret.__v;
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

export const Announcement = mongoose.model('Announcement', announcementSchema);
