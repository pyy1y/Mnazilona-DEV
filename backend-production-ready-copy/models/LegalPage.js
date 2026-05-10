const mongoose = require('mongoose');

const localizedStringSchema = new mongoose.Schema(
  {
    en: { type: String, default: '', trim: true },
    ar: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const legalPageSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['privacy', 'terms'], required: true, unique: true },
    title: { type: localizedStringSchema, default: () => ({}) },
    content: { type: localizedStringSchema, default: () => ({}) },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

module.exports = mongoose.model('LegalPage', legalPageSchema);
