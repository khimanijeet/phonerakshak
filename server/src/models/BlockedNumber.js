const mongoose = require('mongoose');

const blockedNumberSchema = new mongoose.Schema({
  id: { type: String },
  number: { type: String, required: true, unique: true },
  count: { type: Number, default: 1 },
  addedBy: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
  addedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('BlockedNumber', blockedNumberSchema);
