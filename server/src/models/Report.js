const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  id: { type: String },
  deviceId: { type: String, required: true },
  type: { type: String, required: true },
  message: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);
