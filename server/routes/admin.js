const express = require('express');
const router = express.Router();

// Mongoose Models
const Customer = require('../src/models/Customer');
const Device = require('../src/models/Device');
const Alert = require('../src/models/Alert');
const Command = require('../src/models/Command');
const SecurityLog = require('../src/models/SecurityLog');
const SupportTicket = require('../src/models/SupportTicket');
const Intruder = require('../src/models/Intruder');
const Location = require('../src/models/Location');
const BlockedNumber = require('../src/models/BlockedNumber');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

function isOnline(device) {
  if (!device || !device.lastSeen) return false;
  return (Date.now() - new Date(device.lastSeen).getTime() < 5 * 60000);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

router.get('/', requireAuth, async (req, res) => {
  const devices = await Device.find({}).sort({ lastSeen: -1 }).limit(1);
  const device = devices.length > 0 ? devices[0] : null;
  
  if (device) {
    device.online = isOnline(device);
  }

  const locations = device ? await Location.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(20) : [];
  const latest = locations.length > 0 ? locations[0] : null;
  const alerts = device ? await Alert.find({ deviceId: device.deviceId, type: 'sim_change' }).sort({ timestamp: -1 }).limit(10) : [];
  const intruders = device ? await Intruder.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(4) : [];
  const commands = device ? await Command.find({ deviceId: device.deviceId }).sort({ createdAt: -1 }).limit(5) : [];

  res.render('dashboard', {
    user: req.session.user,
    device,
    locations,
    latest,
    alerts,
    intruders,
    commands
  });
});

router.get('/devices', requireAuth, async (req, res) => {
  const devices = await Device.find({}).sort({ lastSeen: -1 });
  const mappedDevices = devices.map(d => {
    const dev = d.toObject();
    dev.online = isOnline(d);
    return dev;
  });
  res.render('devices', { user: req.session.user, devices: mappedDevices });
});

router.get('/devices/:id', requireAuth, async (req, res) => {
  const device = await Device.findOne({ deviceId: req.params.id });
  if (!device) return res.status(404).send('Device not found');
  
  const locations = await Location.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(200);
  const latest = locations.length > 0 ? locations[0] : null;
  const alerts = await Alert.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(100);
  const intruders = await Intruder.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(50);
  const commands = await Command.find({ deviceId: device.deviceId }).sort({ createdAt: -1 }).limit(50);
  
  const dev = device.toObject();
  dev.online = isOnline(device);

  res.render('device', {
    user: req.session.user,
    device: dev,
    locations,
    latest,
    alerts,
    intruders,
    commands,
  });
});

router.post('/devices/:id/command', requireAuth, async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).send('type required');
  await Command.create({ deviceId: req.params.id, type, status: 'pending' });
  res.redirect(`/admin/devices/${req.params.id}`);
});

router.get('/blocked', requireAuth, async (req, res) => {
  const blocked = await BlockedNumber.find({}).sort({ createdAt: -1 });
  res.render('blocked', {
    user: req.session.user,
    blocked,
  });
});

router.get('/users', requireAuth, async (req, res) => {
  const users = await Customer.find({}).sort({ createdAt: -1 });
  const rows = [];
  
  for (const u of users) {
    const devCount = await Device.countDocuments({ phoneNumber: u.phone });
    rows.push([
      `<span class="mono">${u.phone}</span>`,
      u.name || '—',
      u.isPremium ? '<span class="status status-active">Premium</span>' : '<span class="status status-inactive">Free</span>',
      devCount,
      formatDate(u.createdAt)
    ]);
  }

  res.render('generic-list', {
    user: req.session.user,
    active: 'users',
    pageTitle: 'Users',
    count: users.length,
    columns: ['Phone', 'Name', 'Tier', 'Devices', 'Joined'],
    rows
  });
});

router.get('/subscriptions', requireAuth, async (req, res) => {
  const users = await Customer.find({ isPremium: true }).sort({ createdAt: -1 });
  const rows = users.map(u => [
    `<span class="mono">${u.phone}</span>`,
    u.name || '—',
    '<span class="status status-active">Active</span>',
    'Auto-renews',
    formatDate(u.createdAt)
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'subscriptions',
    pageTitle: 'Subscriptions',
    count: users.length,
    columns: ['Phone', 'Name', 'Status', 'Billing', 'Subscribed On'],
    rows
  });
});

router.get('/sim', requireAuth, async (req, res) => {
  const alerts = await Alert.find({ type: 'sim_change' }).sort({ timestamp: -1 }).limit(200);
  const rows = alerts.map(a => [
    `<span class="mono">${a.deviceId}</span>`,
    'SIM Card Swapped',
    `<span class="status status-${a.status}">${a.status}</span>`,
    new Date(a.timestamp).toLocaleString()
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'sim',
    pageTitle: 'SIM Management',
    count: alerts.length,
    columns: ['Device ID', 'Event', 'Status', 'Time'],
    rows
  });
});

router.get('/plans', requireAuth, (req, res) => {
  res.render('plans', { user: req.session.user, active: 'plans' });
});

router.get('/alerts', requireAuth, async (req, res) => {
  const alerts = await Alert.find({}).sort({ timestamp: -1 }).limit(200);
  const rows = alerts.map(a => [
    `<span class="pill pill-grey">${(a.type || '').replace(/_/g, ' ')}</span>`,
    `<span class="mono">${a.deviceId}</span>`,
    a.message || '—',
    `<span class="status status-${a.status}">${a.status}</span>`,
    new Date(a.timestamp).toLocaleString()
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'alerts',
    pageTitle: 'Alerts & Incidents',
    count: alerts.length,
    columns: ['Type', 'Device', 'Message', 'Status', 'Time'],
    rows
  });
});

router.get('/logs', requireAuth, async (req, res) => {
  const logs = await SecurityLog.find({}).sort({ timestamp: -1 }).limit(200);
  const rows = logs.map(l => {
    let t = l.logType === 'alert' ? l.type : (l.logType === 'command' ? 'CMD: ' + l.type : 'Log');
    return [
      `<span class="pill pill-grey">${t.replace(/_/g, ' ')}</span>`,
      `<span class="mono">${l.deviceId}</span>`,
      l.message || (l.logType === 'command' ? 'Command issued' : '—'),
      new Date(l.timestamp || l.createdAt).toLocaleString()
    ];
  });
  res.render('generic-list', {
    user: req.session.user,
    active: 'logs',
    pageTitle: 'Security Logs',
    count: logs.length,
    columns: ['Event', 'Device', 'Details', 'Time'],
    rows
  });
});

router.get('/lock-alarm', requireAuth, async (req, res) => {
  const cmds = await Command.find({ type: { $in: ['lock', 'alarm'] } }).sort({ createdAt: -1 }).limit(200);
  const rows = cmds.map(c => [
    `<span class="pill pill-grey">${c.type}</span>`,
    `<span class="mono">${c.deviceId}</span>`,
    `<span class="status status-${c.status === 'pending' ? 'warning' : 'active'}">${c.status}</span>`,
    new Date(c.createdAt).toLocaleString()
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'lock-alarm',
    pageTitle: 'Lock & Alarm',
    count: cmds.length,
    columns: ['Command', 'Device', 'Status', 'Issued At'],
    rows
  });
});

router.get('/geofence', requireAuth, async (req, res) => {
  const alerts = await Alert.find({ type: 'geofence' }).sort({ timestamp: -1 }).limit(200);
  const rows = alerts.map(a => [
    `<span class="mono">${a.deviceId}</span>`,
    a.message || 'Left safe zone',
    `<span class="status status-${a.status}">${a.status}</span>`,
    new Date(a.timestamp).toLocaleString()
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'geofence',
    pageTitle: 'Geo-Fence Violations',
    count: alerts.length,
    columns: ['Device ID', 'Event', 'Status', 'Time'],
    rows
  });
});

router.get('/commands', requireAuth, async (req, res) => {
  const cmds = await Command.find({}).sort({ createdAt: -1 }).limit(200);
  const rows = cmds.map(c => [
    `<span class="pill pill-grey">${c.type}</span>`,
    `<span class="mono">${c.deviceId}</span>`,
    `<span class="status status-${c.status === 'pending' ? 'warning' : 'active'}">${c.status}</span>`,
    new Date(c.createdAt).toLocaleString()
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'commands',
    pageTitle: 'Commands History',
    count: cmds.length,
    columns: ['Command', 'Device', 'Status', 'Issued At'],
    rows
  });
});

router.get('/health', requireAuth, async (req, res) => {
  const totalUsers = await Customer.countDocuments();
  const activeDevices = await Device.countDocuments({ lastSeen: { $gt: new Date(Date.now() - 5 * 60000) } });
  
  res.render('health', {
    user: req.session.user,
    active: 'health',
    stats: {
      uptime: process.uptime(),
      dbStatus: 'Connected',
      memory: process.memoryUsage().heapUsed,
      activeSockets: 0,
      totalUsers,
      activeDevices
    }
  });
});

router.get('/account', requireAuth, (req, res) => {
  res.render('account', { user: req.session.user, active: 'settings' });
});

router.get('/broadcast', requireAuth, (req, res) => {
  res.render('broadcast', { user: req.session.user, active: 'broadcast' });
});

router.post('/broadcast', requireAuth, (req, res) => {
  res.redirect('/admin/broadcast?sent=1');
});

// SUPPORT TICKETS MIGRATION
router.get('/support', requireAuth, async (req, res) => {
  const tickets = await SupportTicket.find({}).sort({ updatedAt: -1 });
  const rows = tickets.map(t => [
    `<a href="/admin/ticket/${t._id}" class="mono" style="color:#8b5cf6;">${t._id}</a>`,
    `<span class="mono">${t.phone}</span>`,
    `<span class="status status-${t.priority === 'urgent' ? 'warning' : 'active'}">${t.priority}</span>`,
    `<span class="status status-${t.status === 'open' ? 'inactive' : 'active'}">${t.status}</span>`,
    new Date(t.updatedAt).toLocaleString()
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'support',
    pageTitle: 'Support Tickets',
    count: tickets.length,
    columns: ['Ticket ID', 'Customer Phone', 'Priority', 'Status', 'Last Updated'],
    rows
  });
});

// NEW: Admin Chat Interface Render
router.get('/ticket/:id', requireAuth, async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) return res.status(404).send('Ticket not found');
  
  const customer = await Customer.findOne({ phone: ticket.phone });

  res.render('admin-chat', {
    user: req.session.user,
    active: 'support',
    ticket,
    customer
  });
});

// NEW: Admin Reply Endpoint
router.post('/ticket/:id/reply', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).send('Text is required');

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).send('Ticket not found');

    ticket.messages.push({
      text,
      sender: 'admin',
      isBot: false,
      type: 'text',
      timestamp: Date.now()
    });

    if (ticket.status === 'bot_active' || ticket.status === 'escalated' || ticket.status === 'human_assigned') {
      ticket.status = 'in_progress';
    }

    await ticket.save();

    // Broadcast via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(ticket._id.toString()).emit('new_message', { ticket });
    }

    res.json({ success: true, ticket });
  } catch (error) {
    console.error('Admin reply error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// NEW: Admin Status Update Endpoint
router.patch('/ticket/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!ticket) return res.status(404).send('Ticket not found');
    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
