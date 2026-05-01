const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

router.get('/', requireAuth, (req, res) => {
  const devices = db.listDevices();
  const requestedId = req.query.deviceId;
  const device = (requestedId && db.getDevice(requestedId)) || db.getPrimaryDevice();
  const stats = db.getStats();

  let context = null;
  if (device) {
    const latest = db.getLatestLocation(device.deviceId);
    const intruders = db.getIntruderPhotos(device.deviceId, 4);
    const simAlerts = db.getAlertsByType(device.deviceId, 'sim_change', 10);
    const bootEvents = db.getAlertsByType(device.deviceId, 'boot_recovery', 10);
    const commands = db.getCommands(device.deviceId, 5);
    const latestWifi = db.getLatestWifi(device.deviceId);
    const wifiHistory = db.getWifiHistory(device.deviceId, 6);
    context = {
      device: { ...device, online: db.isOnline(device) },
      latest,
      intruders,
      simAlerts,
      bootEvents,
      commands,
      latestWifi,
      wifiHistory,
    };
  }

  res.render('dashboard', {
    user: req.session.user,
    devices,
    stats,
    context,
    notice: req.session.notice || null,
  });
  if (req.session.notice) delete req.session.notice;
});

// Quick remote command from dashboard / sidebar (Lock, Alarm, Locate, etc.)
router.post('/quick-command', requireAuth, (req, res) => {
  const { type, deviceId } = req.body || {};
  const target =
    (deviceId && db.getDevice(deviceId)) || db.getPrimaryDevice();
  if (!target) {
    req.session.notice = { type: 'error', text: 'No device registered yet.' };
    return res.redirect('/admin');
  }
  const allowed = ['lock', 'unlock', 'alarm', 'stop_alarm', 'locate', 'emergency'];
  if (!allowed.includes(type)) {
    req.session.notice = { type: 'error', text: 'Unsupported command.' };
    return res.redirect('/admin');
  }
  db.queueCommand({ deviceId: target.deviceId, type });
  const labels = {
    lock: 'Lock Device',
    unlock: 'Unlock Device',
    alarm: 'Play Alarm',
    stop_alarm: 'Stop Alarm',
    locate: 'Get Location',
    emergency: 'Emergency Mode',
  };
  req.session.notice = {
    type: 'success',
    text: `${labels[type]} command queued — the device will pick it up on its next check-in.`,
  };
  res.redirect('/admin');
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
