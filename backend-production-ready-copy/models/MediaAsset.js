const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    size: { type: Number, required: true, min: 0 },
    url: { type: String, required: true, trim: true },
    category: { type: String, enum: ['hero', 'blog', 'general'], default: 'general', index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

mediaAssetSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
