const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Room name is required'],
      trim: true,
      maxlength: 50,
    },
    icon: {
      type: String,
      default: 'door',
      enum: [
        'door',
        'bed',
        'sofa',
        'silverware-fork-knife',
        'desk',
        'shower',
        'garage',
        'tree',
        'pool',
        'stairs',
        'office-building',
        'home-roof',
      ],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

roomSchema.index({ owner: 1, name: 1 }, { unique: true });
roomSchema.index({ owner: 1, order: 1 });

roomSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId }).sort({ order: 1, createdAt: 1 });
};

module.exports = mongoose.model('Room', roomSchema);
