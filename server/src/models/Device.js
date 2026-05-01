const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  phoneNumber: { type: String, default: '' },
  emergencyNumber: { type: String, default: '' },
  deviceModel: { type: String, default: '' },
  city: { type: String, default: 'Others' },
  fcmToken: { type: String, default: null },
  registeredAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);
