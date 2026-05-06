const mongoose = require('mongoose');

const trustedContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: '' }
}, { _id: true });

const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  firebaseUid: { type: String, required: true, unique: true, sparse: true },
  plan: { type: String, default: 'free' },
  deviceLimit: { type: Number, default: 1 },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  isPremium: { type: Boolean, default: false },
  trustedContacts: [trustedContactSchema],
  settings: {
    pushNotifications: { type: Boolean, default: true },
    alertSounds: { type: Boolean, default: true },
    dataSync: { type: Boolean, default: true },
    locationSharing: { type: Boolean, default: false },
    autoBackup: { type: Boolean, default: false },
    advancedAlerts: { type: Boolean, default: false }
  }
}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);
