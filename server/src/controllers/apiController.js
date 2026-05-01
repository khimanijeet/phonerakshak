const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const BlockedNumber = require('../models/BlockedNumber');
const Report = require('../models/Report');
const logger = require('../utils/logger');

exports.upsertDevice = async (req, res, next) => {
  try {
    const { deviceId, phoneNumber, emergencyNumber, deviceModel, city } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    
    let device = await Device.findOne({ deviceId });
    if (device) {
      device.phoneNumber = phoneNumber || device.phoneNumber;
      device.emergencyNumber = emergencyNumber || device.emergencyNumber;
      device.deviceModel = deviceModel || device.deviceModel;
      device.city = city || device.city;
      device.lastSeen = Date.now();
      await device.save();
    } else {
      device = await Device.create({ deviceId, phoneNumber, emergencyNumber, deviceModel, city, registeredAt: Date.now(), lastSeen: Date.now() });
    }
    res.json({ ok: true, device });
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
    await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() });
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
    await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() });
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.getCommands = async (req, res, next) => {
  try {
    const pending = await Command.find({ deviceId: req.params.id, status: 'pending' });
    if (pending.length > 0) {
      await Command.updateMany(
        { _id: { $in: pending.map(c => c._id) } },
        { status: 'delivered', deliveredAt: Date.now() }
      );
      await Device.findOneAndUpdate({ deviceId: req.params.id }, { lastSeen: Date.now() });
    }
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
      command.status = 'done';
      command.ackedAt = Date.now();
      command.result = result;
      await command.save();
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
    await Alert.create({
      deviceId,
      type: 'intruder_photo',
      message: 'Intruder photo captured',
      meta: { filename: req.file.filename }
    });
    await Report.create({ deviceId, type: 'intruder_photo', message: 'Intruder photo captured' });
    await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() });
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};
