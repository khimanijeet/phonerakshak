const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  id: { type: String }, // Old legacy id format
  deviceId: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy: { type: Number, default: null },
  trigger: { type: String, default: 'manual' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

// Indexing deviceId for faster queries
locationSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('Location', locationSchema);
