const mongoose = require('mongoose');

const audioRecordingSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  filename: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('AudioRecording', audioRecordingSchema);
