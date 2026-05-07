const mongoose = require('mongoose');

const trustedContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: '' }
}, { _id: true });

const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: '' },
  passwordHash: { type: String },
  firebaseUid: { type: String, unique: true, sparse: true },
  plan: { type: String, enum: ['free', 'plus', 'premium'], default: 'free' },
  subscriptionStatus: { type: String, enum: ['active', 'expired', 'cancelled', 'suspended'], default: 'active' },
  subscriptionUpdatedAt: { type: Date },
  subscriptionExpiry: { type: Date },
  paymentProvider: { type: String },
  paymentId: { type: String },
  deviceLimit: { type: Number, default: 1 },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
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
