const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema({
  id: { type: String },
  deviceId: { type: String, required: true },
  type: { type: String, required: true },
  params: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, enum: ['pending', 'delivered', 'done'], default: 'pending' },
  queuedAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date, default: null },
  ackedAt: { type: Date, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

commandSchema.index({ deviceId: 1, status: 1 });

module.exports = mongoose.model('Command', commandSchema);
