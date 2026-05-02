const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const BlockedNumber = require('../models/BlockedNumber');
const Report = require('../models/Report');
const SecurityLog = require('../models/SecurityLog');

const isOnline = (device, windowMs = 5 * 60 * 1000) => {
  return device && device.lastSeen && (Date.now() - new Date(device.lastSeen).getTime()) < windowMs;
};

exports.getDashboard = async (req, res, next) => {
  try {
    const devices = await Device.find().sort({ lastSeen: -1 });
    let device = devices.length > 0 ? devices[0].toObject() : null;
    
    if (device) {
      device.online = isOnline(device);
    }

    const locations = device ? await Location.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(20) : [];
    const latest = locations.length > 0 ? locations[0] : null;
    const alerts = device ? await Alert.find({ deviceId: device.deviceId, type: 'sim_change' }).sort({ timestamp: -1 }).limit(10) : [];
    const intruders = device ? await Intruder.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(4) : [];
    const audioClips = device ? await AudioRecording.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(3) : [];
    const commands = device ? await Command.find({ deviceId: device.deviceId }).sort({ queuedAt: -1 }).limit(5) : [];

    res.render('dashboard', {
      user: req.session.user,
      device, locations, latest, alerts, intruders, audioClips, commands
    });
  } catch (err) { next(err); }
};

exports.getDevices = async (req, res, next) => {
  try {
    let devices = await Device.find().sort({ lastSeen: -1 }).lean();
    devices = devices.map(d => ({ ...d, online: isOnline(d) }));
    res.render('devices', { user: req.session.user, devices });
  } catch (err) { next(err); }
};

exports.getDevice = async (req, res, next) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.id }).lean();
    if (!device) return res.status(404).send('Device not found');
    
    const locations = await Location.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(200);
    const latest = locations.length > 0 ? locations[0] : null;
    const alerts = await Alert.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(100);
    const intruders = await Intruder.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(50);
    const audioClips = await AudioRecording.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(50);
    const commands = await Command.find({ deviceId: device.deviceId }).sort({ queuedAt: -1 }).limit(50);
    
    res.render('device', {
      user: req.session.user,
      device: { ...device, online: isOnline(device) },
      locations, latest, alerts, intruders, audioClips, commands
    });
  } catch (err) { next(err); }
};

const { sendPushCommand } = require('../utils/firebase');

exports.sendCommand = async (req, res, next) => {
  try {
    const { type } = req.body;
    if (!type) return res.status(400).send('type required');
    
    // Create command in DB as queued for polling fallback
    let command = await Command.create({ deviceId: req.params.id, type, status: 'queued', queuedAt: Date.now() });
    
    // Attempt instant delivery via FCM
    const device = await Device.findOne({ deviceId: req.params.id });
    if (device && device.fcmToken) {
      const payload = {
        commandId: command._id.toString(),
        type: type,
        timestamp: Date.now().toString()
      };
      
      const success = await sendPushCommand(device.fcmToken, payload);
      if (success) {
        command.status = 'processing';
        command.processingAt = Date.now();
        await command.save();
      } else {
        // If FCM definitively fails (e.g., unregistered token), we might want to clear it
        // but for now, we leave the command as 'queued' so polling picks it up.
      }
    }
    
    const io = req.app.get('io');
    if (io) io.emit('command_status_change', command);
    
    res.redirect(`/admin/devices/${req.params.id}`);
  } catch (err) { next(err); }
};

exports.getBlocked = async (req, res, next) => {
  try {
    const blocked = await BlockedNumber.find().sort({ count: -1 }).lean();
    res.render('blocked', { user: req.session.user, blocked });
  } catch (err) { next(err); }
};

exports.getReports = async (req, res, next) => {
  try {
    const reports = await Alert.find().sort({ timestamp: -1 }).limit(200).lean();
    res.render('reports', { user: req.session.user, reports, active: 'reports' });
  } catch (err) { next(err); }
};

exports.getSecurityLogs = async (req, res, next) => {
  try {
    const logs = await SecurityLog.find().sort({ timestamp: -1 }).limit(200).lean();
    res.render('security', { user: req.session.user, logs, active: 'security' });
  } catch (err) { next(err); }
};
