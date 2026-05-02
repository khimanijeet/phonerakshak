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

router.get('/reports', requireAuth, (req, res) => {
  res.render('reports', {
    user: req.session.user,
    reports: db.getAllAlerts(200),
    active: 'reports'
  });
});

router.get('/security', requireAuth, (req, res) => {
  res.render('security', {
    user: req.session.user,
    logs: db.getSecurityLogs(200),
    active: 'security'
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
