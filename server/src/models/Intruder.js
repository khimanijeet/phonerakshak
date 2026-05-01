const mongoose = require('mongoose');

const intruderSchema = new mongoose.Schema({
  id: { type: String },
  deviceId: { type: String, required: true },
  filename: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

intruderSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('Intruder', intruderSchema);
