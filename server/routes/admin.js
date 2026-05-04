const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

router.get('/', requireAuth, (req, res) => {
  const devices = db.listDevices();
  const device = devices.length > 0 ? devices[0] : null;
  
  if (device) {
    device.online = db.isOnline(device);
  }

  const locations = device ? db.getLocations(device.deviceId, 20) : [];
  const latest = device ? db.getLatestLocation(device.deviceId) : null;
  const alerts = device ? db.getAlerts(device.deviceId, 10).filter(a => a.type === 'sim_change') : [];
  const intruders = device ? db.getIntruderPhotos(device.deviceId, 4) : [];
  const commands = device ? db.getCommands(device.deviceId, 5) : [];

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

router.get('/devices', requireAuth, (req, res) => {
  const devices = db.listDevices().map((d) => ({
    ...d,
    online: db.isOnline(d),
  }));
  res.render('devices', { user: req.session.user, devices });
});

router.get('/devices/:id', requireAuth, (req, res) => {
  const device = db.getDevice(req.params.id);
  if (!device) return res.status(404).send('Device not found');
  const locations = db.getLocations(device.deviceId, 200);
  const latest = db.getLatestLocation(device.deviceId);
  const alerts = db.getAlerts(device.deviceId, 100);
  const intruders = db.getIntruderPhotos(device.deviceId, 50);
  const commands = db.getCommands(device.deviceId, 50);
  res.render('device', {
    user: req.session.user,
    device: { ...device, online: db.isOnline(device) },
    locations,
    latest,
    alerts,
    intruders,
    commands,
  });
});

router.post('/devices/:id/command', requireAuth, (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).send('type required');
  db.queueCommand({ deviceId: req.params.id, type });
  res.redirect(`/admin/devices/${req.params.id}`);
});

router.get('/blocked', requireAuth, (req, res) => {
  res.render('blocked', {
    user: req.session.user,
    blocked: db.getAllBlockedNumbers(),
  });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.getAllCustomers();
  const rows = users.map(u => [
    `<span class="mono">${u.phone}</span>`,
    u.name || '—',
    u.isPremium ? '<span class="status status-active">Premium</span>' : '<span class="status status-inactive">Free</span>',
    u.devices ? u.devices.length : 0,
    formatDate(u.createdAt)
  ]);
  res.render('generic-list', {
    user: req.session.user,
    active: 'users',
    pageTitle: 'Users',
    count: users.length,
    columns: ['Phone', 'Name', 'Tier', 'Devices', 'Joined'],
    rows
  });
});

router.get('/subscriptions', requireAuth, (req, res) => {
  const users = db.getAllCustomers().filter(u => u.isPremium);
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

router.get('/sim', requireAuth, (req, res) => {
  const alerts = db.getAllAlerts(200).filter(a => a.type === 'sim_change');
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

router.get('/alerts', requireAuth, (req, res) => {
  const alerts = db.getAllAlerts(200);
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

router.get('/logs', requireAuth, (req, res) => {
  const logs = db.getSecurityLogs(200);
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

router.get('/lock-alarm', requireAuth, (req, res) => {
  const cmds = db.getAllCommands().filter(c => c.type === 'lock' || c.type === 'alarm');
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

router.get('/geofence', requireAuth, (req, res) => {
  const alerts = db.getAllAlerts(200).filter(a => a.type === 'geofence');
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

router.get('/commands', requireAuth, (req, res) => {
  const cmds = db.getAllCommands();
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

router.get('/health', requireAuth, (req, res) => {
  res.render('health', {
    user: req.session.user,
    active: 'health',
    stats: db.getStats()
  });
});

router.get('/account', requireAuth, (req, res) => {
  res.render('account', { user: req.session.user, active: 'settings' });
});

router.get('/broadcast', requireAuth, (req, res) => {
  res.render('broadcast', { user: req.session.user, active: 'broadcast' });
});

router.post('/broadcast', requireAuth, (req, res) => {
  // In a real app, this would trigger FCM to all devices.
  res.redirect('/admin/broadcast?sent=1');
});

router.get('/support', requireAuth, (req, res) => {
  const tickets = db.getAllSupportTickets();
  const rows = tickets.map(t => [
    `<span class="mono">${t.id}</span>`,
    `<span class="mono">${t.phone}</span>`,
    `<span class="status status-${t.priority === 'high' ? 'warning' : 'active'}">${t.priority}</span>`,
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

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function makeFakeDeltas() {
  // Static % deltas used to mirror the visual mock.
  return {
    totalUsers: 12.5,
    activeUsers: 9.8,
    sosAlerts: 15.3,
    blockedNumbers: 10.7,
    reportsFiled: 8.6,
    callsMonitored: 11.2,
    devicesRegistered: 9.3,
  };
}

module.exports = router;
