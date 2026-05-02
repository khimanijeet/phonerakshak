const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  ip: { type: String, required: true },
  type: { type: String, required: true },
  message: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('SecurityLog', securityLogSchema);
