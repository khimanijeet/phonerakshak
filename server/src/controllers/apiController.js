const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const BlockedNumber = require('../models/BlockedNumber');
const Report = require('../models/Report');
const AudioRecording = require('../models/AudioRecording');
const logger = require('../utils/logger');
const { generateToken } = require('../middlewares/auth');

exports.upsertDevice = async (req, res, next) => {
  try {
    const { deviceId, phoneNumber, emergencyNumber, deviceModel, city, fcmToken } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    
    let device = await Device.findOne({ deviceId });
    if (device) {
      device.phoneNumber = phoneNumber || device.phoneNumber;
      device.emergencyNumber = emergencyNumber || device.emergencyNumber;
      device.deviceModel = deviceModel || device.deviceModel;
      device.city = city || device.city;
      if (fcmToken) device.fcmToken = fcmToken;
      device.lastSeen = Date.now();
      await device.save();
    } else {
      device = await Device.create({ deviceId, phoneNumber, emergencyNumber, deviceModel, city, fcmToken, registeredAt: Date.now(), lastSeen: Date.now() });
    }
    
    const io = req.app.get('io');
    if (io) io.emit('device_updated', device);
    
    const token = generateToken(device.deviceId);
    res.json({ ok: true, device, token });
  } catch (err) { next(err); }
};

exports.pingDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Device.findOneAndUpdate({ deviceId: id }, { lastSeen: Date.now() });
    res.json({ ok: true });
  } catch (err) { next(err); }
};

exports.addLocation = async (req, res, next) => {
  try {
    const { deviceId, latitude, longitude, accuracy, trigger } = req.body || {};
    if (!deviceId || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'deviceId, latitude, longitude required' });
    }
    const entry = await Location.create({
      deviceId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy != null ? Number(accuracy) : null,
      trigger
    });
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_location', entry);
      io.emit('device_updated', device);
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.addAlert = async (req, res, next) => {
  try {
    const { deviceId, type, message, meta } = req.body || {};
    if (!deviceId || !type) return res.status(400).json({ error: 'deviceId and type required' });
    
    const entry = await Alert.create({ deviceId, type, message, meta });
    await Report.create({ deviceId, type, message, status: 'pending', timestamp: entry.timestamp });
    
    const blocked = (meta && (meta.blockedNumber || meta.number)) || (type === 'blocked_call' && message);
    if (blocked) {
      let bNumber = await BlockedNumber.findOne({ number: String(blocked) });
      if (bNumber) {
        bNumber.count += 1;
        bNumber.lastSeen = Date.now();
        await bNumber.save();
      } else {
        await BlockedNumber.create({ number: String(blocked), count: 1, addedBy: deviceId, lastSeen: Date.now() });
      }
    }
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_alert', entry);
      io.emit('device_updated', device);
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.getCommands = async (req, res, next) => {
  try {
    const fifteenSecsAgo = new Date(Date.now() - 15000);
    const pending = await Command.find({ 
      deviceId: req.params.id, 
      $or: [
        { status: 'queued' },
        { status: 'processing', processingAt: { $lt: fifteenSecsAgo } }
      ]
    });
    
    if (pending.length > 0) {
      await Command.updateMany(
        { _id: { $in: pending.map(c => c._id) } },
        { status: 'processing', processingAt: Date.now() }
      );
      await Device.findOneAndUpdate({ deviceId: req.params.id }, { lastSeen: Date.now() });
    }
    
    // Convert to what Android expects or just send
    // Since Android might still expect 'pending' -> 'delivered', wait,
    // we should just return the documents. The Android app checks if response is successful.
    res.json({ commands: pending });
  } catch (err) { next(err); }
};

exports.ackCommand = async (req, res, next) => {
  try {
    const { id, cid } = req.params;
    const { result } = req.body;
    
    // Find by the command _id or by the custom id field if passed as cid
    const command = await Command.findOne({ _id: cid, deviceId: id }).catch(() => Command.findOne({ id: cid, deviceId: id }));
    
    if (command) {
      command.status = 'executed';
      command.ackedAt = Date.now();
      command.result = result;
      await command.save();
      
      const io = req.app.get('io');
      if (io) io.emit('command_status_change', command);
      
      res.json({ ok: true });
    } else {
      res.json({ ok: false });
    }
  } catch (err) { next(err); }
};

exports.addIntruder = async (req, res, next) => {
  try {
    const deviceId = req.body.deviceId || (req.file && req.file.filename) ? req.body.deviceId : null;
    if (!deviceId || !req.file) return res.status(400).json({ error: 'deviceId and photo required' });
    
    const entry = await Intruder.create({ deviceId, filename: req.file.filename });
    const alertEntry = await Alert.create({
      deviceId,
      type: 'intruder_photo',
      message: 'Intruder photo captured',
      meta: { filename: req.file.filename }
    });
    await Report.create({ deviceId, type: 'intruder_photo', message: 'Intruder photo captured' });
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_intruder', entry);
      io.emit('new_alert', alertEntry);
      io.emit('device_updated', device);
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.addAudio = async (req, res, next) => {
  try {
    const deviceId = req.body.deviceId || (req.file && req.file.filename) ? req.body.deviceId : null;
    if (!deviceId || !req.file) return res.status(400).json({ error: 'deviceId and audio required' });
    
    const entry = await AudioRecording.create({ deviceId, filename: req.file.filename });
    const alertEntry = await Alert.create({
      deviceId,
      type: 'audio_surveillance',
      message: 'Ambient audio recorded',
      meta: { filename: req.file.filename }
    });
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_audio', entry);
      io.emit('new_alert', alertEntry);
      io.emit('device_updated', device);
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.registerFace = async (req, res, next) => {
  try {
    const { deviceId, faceDescriptor } = req.body;
    if (!deviceId || !faceDescriptor || !Array.isArray(faceDescriptor)) {
      return res.status(400).json({ error: 'deviceId and faceDescriptor array required' });
    }
    
    // Generate a simple 6 digit recovery code
    const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const device = await Device.findOneAndUpdate(
      { deviceId }, 
      { faceDescriptor, recoveryCode },
      { new: true }
    );
    
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    res.json({ ok: true, recoveryCode });
  } catch (err) { next(err); }
};

exports.verifyFace = async (req, res, next) => {
  try {
    const { recoveryCode, liveDescriptor } = req.body;
    if (!recoveryCode || !liveDescriptor || !Array.isArray(liveDescriptor)) {
      return res.status(400).json({ error: 'recoveryCode and liveDescriptor array required' });
    }
    
    const device = await Device.findOne({ recoveryCode });
    if (!device) return res.status(404).json({ error: 'Invalid recovery code' });
    
    if (!device.faceDescriptor || device.faceDescriptor.length === 0) {
      return res.status(400).json({ error: 'No face descriptor registered for this account' });
    }
    
    // Calculate Euclidean distance
    let distance = 0;
    for (let i = 0; i < device.faceDescriptor.length; i++) {
      distance += Math.pow(device.faceDescriptor[i] - (liveDescriptor[i] || 0), 2);
    }
    distance = Math.sqrt(distance);
    
    // Threshold for matching
    const THRESHOLD = 1.0; 
    
    if (distance < THRESHOLD) {
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'phonerakshak_super_secret_key_123!';
      const token = jwt.sign({ deviceId: device.deviceId, role: 'recovery' }, JWT_SECRET, { expiresIn: '1h' });
      
      res.json({ ok: true, token, deviceId: device.deviceId });
    } else {
      res.status(401).json({ error: 'Face verification failed' });
    }
  } catch (err) { next(err); }
};

exports.getGeofence = async (req, res, next) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.id });
    if (!device) return res.status(404).send('Device not found');
    res.json(device.geofence || { enabled: false });
  } catch (err) { next(err); }
};
