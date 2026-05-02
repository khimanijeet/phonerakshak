const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  phoneNumber: { type: String, default: '' },
  emergencyNumber: { type: String, default: '' },
  deviceModel: { type: String, default: '' },
  city: { type: String, default: 'Others' },
  fcmToken: { type: String, default: null },
  recoveryCode: { type: String, unique: true, sparse: true },
  faceDescriptor: { type: [Number], default: [] },
  geofence: {
    enabled: { type: Boolean, default: false },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    radius: { type: Number, default: 100 } // Radius in meters
  },
  registeredAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);
