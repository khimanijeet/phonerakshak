const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const BlockedNumber = require('../models/BlockedNumber');
const Report = require('../models/Report');
const SecurityLog = require('../models/SecurityLog');
const AudioRecording = require('../models/AudioRecording');
const Config = require('../models/Config');
const Customer = require('../models/Customer');
const SupportTicket = require('../models/SupportTicket');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const isOnline = (device, windowMs = 5 * 60 * 1000) => {
  return device && device.lastSeen && (Date.now() - new Date(device.lastSeen).getTime()) < windowMs;
};

exports.getDashboard = async (req, res, next) => {
  try {
    const devices = await Device.find().sort({ lastSeen: -1 }).lean();
    let stats = {
      totalUsers: devices.length,
      activeUsers: devices.filter(d => isOnline(d)).length,
      devicesRegistered: devices.length
    };
    
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(50).lean();
    const commands = await Command.find().sort({ queuedAt: -1 }).limit(50).lean();
    
    // Calculate daily series for charts
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentAlerts = await Alert.find({ timestamp: { $gte: sevenDaysAgo } }).lean();
    const dailySeries = {
      labels: [],
      sos: [],
      reports: []
    };
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toISOString().split('T')[0];
      dailySeries.labels.push(label);
      
      const dayAlerts = recentAlerts.filter(a => {
        const aDate = new Date(a.timestamp).toISOString().split('T')[0];
        return aDate === label;
      });
      
      dailySeries.sos.push(dayAlerts.filter(a => ['brute_force', 'failed_login', 'ddos'].includes(a.type)).length);
      dailySeries.reports.push(dayAlerts.filter(a => !['brute_force', 'failed_login', 'ddos'].includes(a.type)).length);
    }

    res.render('dashboard', {
      user: req.session.user,
      customers: devices, 
      devices,
      stats, 
      alerts, 
      commands,
      dailySeries,
      device: null
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

exports.updateGeofence = async (req, res, next) => {
  try {
    const { enabled, lat, lng, radius } = req.body;
    const device = await Device.findOne({ deviceId: req.params.id });
    if (!device) return res.status(404).send('Device not found');
    
    device.geofence = {
      enabled: enabled === 'on' || enabled === true,
      lat: parseFloat(lat) || null,
      lng: parseFloat(lng) || null,
      radius: parseInt(radius) || 100
    };
    await device.save();
    
    // Create a background command to force the device to sync its geofence immediately
    await Command.create({ deviceId: req.params.id, type: 'sync_geofence', status: 'queued', queuedAt: Date.now() });
    
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

exports.getSetup2FA = async (req, res, next) => {
  try {
    const config = await Config.findOne({ key: 'admin_2fa_secret' });
    if (config) {
      return res.render('setup-2fa', { isEnabled: true });
    }
    
    // Generate new secret
    const secret = speakeasy.generateSecret({ name: 'PhoneRakshak Admin' });
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    
    // Store temporarily in session
    req.session.tempSecret = secret.base32;
    
    res.render('setup-2fa', { isEnabled: false, qrDataUrl, secret: secret.base32, error: null });
  } catch (err) { next(err); }
};

exports.postSetup2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const tempSecret = req.session.tempSecret;
    
    if (!tempSecret) {
      return res.redirect('/admin/setup-2fa');
    }
    
    const verified = speakeasy.totp.verify({
      secret: tempSecret,
      encoding: 'base32',
      token: token,
      window: 1
    });
    
    if (verified) {
      await Config.create({ key: 'admin_2fa_secret', value: tempSecret });
      req.session.tempSecret = null;
      res.redirect('/admin/setup-2fa');
    } else {
      const qrDataUrl = await qrcode.toDataURL(`otpauth://totp/PhoneRakshak%20Admin?secret=${tempSecret}`);
      res.render('setup-2fa', { isEnabled: false, qrDataUrl, secret: tempSecret, error: 'Invalid authenticator code. Try again.' });
    }
  } catch (err) { next(err); }
};

exports.disable2FA = async (req, res, next) => {
  try {
    const { password } = req.body;
    const bcrypt = require('bcryptjs');
    const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    
    if (bcrypt.compareSync(password || '', ADMIN_PASSWORD_HASH)) {
      await Config.deleteOne({ key: 'admin_2fa_secret' });
    }
    res.redirect('/admin/setup-2fa');
  } catch (err) { next(err); }
};

// --- NEW MVC ROUTES FOR SIDEBAR ---

exports.getUsers = async (req, res, next) => {
  try {
    const users = await Customer.find().sort({ createdAt: -1 }).lean();
    const rows = users.map(u => [
      `<span class="mono">${u.phone}</span>`,
      u.name || '—',
      u.isPremium ? '<span class="status status-active">Premium</span>' : '<span class="status status-inactive">Free</span>',
      u.devices ? u.devices.length : 0,
      formatDate(u.createdAt)
    ]);
    res.render('generic-list', { user: req.session.user, active: 'users', pageTitle: 'Users', count: users.length, columns: ['Phone', 'Name', 'Tier', 'Devices', 'Joined'], rows });
  } catch (err) { next(err); }
};

exports.getSubscriptions = async (req, res, next) => {
  try {
    const users = await Customer.find({ isPremium: true }).sort({ createdAt: -1 }).lean();
    const rows = users.map(u => [
      `<span class="mono">${u.phone}</span>`,
      u.name || '—',
      '<span class="status status-active">Active</span>',
      'Auto-renews',
      formatDate(u.createdAt)
    ]);
    res.render('generic-list', { user: req.session.user, active: 'subscriptions', pageTitle: 'Subscriptions', count: users.length, columns: ['Phone', 'Name', 'Status', 'Billing', 'Subscribed On'], rows });
  } catch (err) { next(err); }
};

exports.getSim = async (req, res, next) => {
  try {
    const alerts = await Alert.find({ type: 'sim_change' }).sort({ timestamp: -1 }).limit(200).lean();
    const rows = alerts.map(a => [
      `<span class="mono">${a.deviceId}</span>`,
      'SIM Card Swapped',
      `<span class="status status-${a.status}">${a.status}</span>`,
      new Date(a.timestamp).toLocaleString()
    ]);
    res.render('generic-list', { user: req.session.user, active: 'sim', pageTitle: 'SIM Management', count: alerts.length, columns: ['Device ID', 'Event', 'Status', 'Time'], rows });
  } catch (err) { next(err); }
};

exports.getPlans = (req, res) => {
  res.render('plans', { user: req.session.user, active: 'plans' });
};

exports.getAlerts = async (req, res, next) => {
  try {
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(200).lean();
    const rows = alerts.map(a => [
      `<span class="pill pill-grey">${(a.type || '').replace(/_/g, ' ')}</span>`,
      `<span class="mono">${a.deviceId}</span>`,
      a.message || '—',
      `<span class="status status-${a.status}">${a.status}</span>`,
      new Date(a.timestamp).toLocaleString()
    ]);
    res.render('generic-list', { user: req.session.user, active: 'alerts', pageTitle: 'Alerts & Incidents', count: alerts.length, columns: ['Type', 'Device', 'Message', 'Status', 'Time'], rows });
  } catch (err) { next(err); }
};

exports.getLogs = async (req, res, next) => {
  try {
    const logs = await SecurityLog.find().sort({ timestamp: -1 }).limit(300).lean();
    const rows = logs.map(l => [
      `<span class="pill pill-grey">${(l.type || 'Log').replace(/_/g, ' ')}</span>`,
      `<span class="mono">${l.ip || '—'}</span>`,
      l.message || '—',
      new Date(l.timestamp || l.createdAt).toLocaleString()
    ]);
    res.render('generic-list', { user: req.session.user, active: 'logs', pageTitle: 'Security Logs', count: logs.length, columns: ['Event', 'IP / Device', 'Details', 'Time'], rows });
  } catch (err) { next(err); }
};

exports.getLockAlarm = async (req, res, next) => {
  try {
    const cmds = await Command.find({ type: { $in: ['lock', 'alarm'] } }).sort({ queuedAt: -1 }).limit(200).lean();
    const rows = cmds.map(c => [
      `<span class="pill pill-grey">${c.type}</span>`,
      `<span class="mono">${c.deviceId}</span>`,
      `<span class="status status-${c.status === 'pending' || c.status === 'queued' ? 'warning' : 'active'}">${c.status}</span>`,
      new Date(c.queuedAt || c.createdAt).toLocaleString()
    ]);
    res.render('generic-list', { user: req.session.user, active: 'lock-alarm', pageTitle: 'Lock & Alarm', count: cmds.length, columns: ['Command', 'Device', 'Status', 'Issued At'], rows });
  } catch (err) { next(err); }
};

exports.getGeofence = async (req, res, next) => {
  try {
    const alerts = await Alert.find({ type: 'geofence' }).sort({ timestamp: -1 }).limit(200).lean();
    const rows = alerts.map(a => [
      `<span class="mono">${a.deviceId}</span>`,
      a.message || 'Left safe zone',
      `<span class="status status-${a.status}">${a.status}</span>`,
      new Date(a.timestamp).toLocaleString()
    ]);
    res.render('generic-list', { user: req.session.user, active: 'geofence', pageTitle: 'Geo-Fence Violations', count: alerts.length, columns: ['Device ID', 'Event', 'Status', 'Time'], rows });
  } catch (err) { next(err); }
};

exports.getCommands = async (req, res, next) => {
  try {
    const cmds = await Command.find().sort({ queuedAt: -1 }).limit(200).lean();
    const rows = cmds.map(c => [
      `<span class="pill pill-grey">${c.type}</span>`,
      `<span class="mono">${c.deviceId}</span>`,
      `<span class="status status-${c.status === 'pending' || c.status === 'queued' ? 'warning' : 'active'}">${c.status}</span>`,
      new Date(c.queuedAt || c.createdAt).toLocaleString()
    ]);
    res.render('generic-list', { user: req.session.user, active: 'commands', pageTitle: 'Commands History', count: cmds.length, columns: ['Command', 'Device', 'Status', 'Issued At'], rows });
  } catch (err) { next(err); }
};

exports.getHealth = async (req, res, next) => {
  try {
    const stats = {
      totalUsers: await Customer.countDocuments(),
      devicesRegistered: await Device.countDocuments(),
      sosAlerts: await Alert.countDocuments(),
      callsMonitored: (await Device.aggregate([{ $group: { _id: null, total: { $sum: "$callsMonitored" } } }]))[0]?.total || 0,
      blockedNumbers: await BlockedNumber.countDocuments()
    };
    res.render('health', { user: req.session.user, active: 'health', stats });
  } catch (err) { next(err); }
};

exports.getAccount = (req, res) => res.render('account', { user: req.session.user, active: 'settings' });

exports.getBroadcast = (req, res) => res.render('broadcast', { user: req.session.user, active: 'broadcast' });

exports.postBroadcast = (req, res) => res.redirect('/admin/broadcast?sent=1');

exports.getSupport = async (req, res, next) => {
  try {
    res.render('admin/support', { user: req.session.user, active: 'support' });
  } catch (err) { next(err); }
};

exports.getApiTickets = async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find().sort({ updatedAt: -1 }).lean();
    
    const list = tickets.map(t => {
      const lastMsg = t.messages && t.messages.length > 0 ? t.messages[t.messages.length - 1] : null;
      const unread = lastMsg && lastMsg.sender === 'user';
      
      return {
        ticketId: t._id,
        phone: t.phone,
        issueType: t.issueType,
        priority: t.priority,
        status: t.status,
        lastMessage: lastMsg ? lastMsg.text : '',
        unread: unread,
        updatedAt: t.updatedAt,
        createdAt: t.createdAt
      };
    });
    
    const stats = {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      urgent: tickets.filter(t => t.priority === 'urgent').length,
      avgResponse: '14m' 
    };
    
    res.json({ tickets: list, stats });
  } catch (err) { next(err); }
};

exports.getApiTicketHistory = async (req, res, next) => {
  try {
    const { ticketId } = req.query;
    if (!ticketId) return res.status(400).send('ticketId required');
    const tkt = await SupportTicket.findById(ticketId).lean();
    if (!tkt) return res.status(404).send('Not found');
    res.json({ ticket: tkt });
  } catch (err) { next(err); }
};

exports.postApiSupportChat = async (req, res, next) => {
  try {
    const { ticketId, message } = req.body;
    if (!ticketId || !message) return res.status(400).send('ticketId and message required');
    
    const tkt = await SupportTicket.findById(ticketId);
    if (!tkt) return res.status(404).send('Not found');
    
    tkt.messages.push({
      text: message,
      isBot: false,
      sender: 'admin',
      type: 'text',
      timestamp: Date.now()
    });
    
    if (tkt.status !== 'resolved' && tkt.status !== 'in_progress') {
      tkt.status = 'human_assigned';
    }
    
    await tkt.save();
    res.json({ ticket: tkt });
  } catch (err) { next(err); }
};

exports.patchApiTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const tkt = await SupportTicket.findById(id);
    if (!tkt) return res.status(404).send('Not found');
    
    tkt.status = status;
    await tkt.save();
    res.json({ success: true, ticket: tkt });
  } catch (err) { next(err); }
};
