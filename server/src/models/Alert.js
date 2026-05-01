const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  id: { type: String },
  deviceId: { type: String, required: true },
  type: { type: String, default: 'info' },
  message: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, default: 'pending' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

alertSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('Alert', alertSchema);
