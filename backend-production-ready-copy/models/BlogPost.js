const mongoose = require('mongoose');

const localizedStringSchema = new mongoose.Schema(
  {
    en: { type: String, default: '', trim: true },
    ar: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const blogPostSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be URL friendly'],
      maxlength: 160,
    },
    title: { type: localizedStringSchema, required: true, default: () => ({}) },
    excerpt: { type: localizedStringSchema, default: () => ({}) },
    content: { type: localizedStringSchema, default: () => ({}) },
    coverImageUrl: { type: String, default: '', trim: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    publishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

blogPostSchema.index({ status: 1, publishedAt: -1 });
blogPostSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BlogPost', blogPostSchema);
