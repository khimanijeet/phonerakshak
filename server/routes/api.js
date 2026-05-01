const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, db.INTRUDERS_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

// Register / update device
router.post('/devices', (req, res) => {
  const { deviceId, phoneNumber, emergencyNumber, deviceModel, city } =
    req.body || {};
  if (!deviceId)
    return res.status(400).json({ error: 'deviceId required' });
  const device = db.upsertDevice({
    deviceId,
    phoneNumber,
    emergencyNumber,
    deviceModel,
    city,
  });
  res.json({ ok: true, device });
});

// Heartbeat
router.post('/devices/:id/ping', (req, res) => {
  db.touchDevice(req.params.id);
  res.json({ ok: true });
});

// Locations
router.post('/locations', (req, res) => {
  const { deviceId, latitude, longitude, accuracy, trigger } = req.body || {};
  if (!deviceId || latitude == null || longitude == null)
    return res.status(400).json({ error: 'deviceId, latitude, longitude required' });
  const entry = db.addLocation({
    deviceId,
    latitude: Number(latitude),
    longitude: Number(longitude),
    accuracy: accuracy != null ? Number(accuracy) : null,
    trigger,
  });
  res.json({ ok: true, entry });
});

// Alerts
router.post('/alerts', (req, res) => {
  const { deviceId, type, message, meta } = req.body || {};
  if (!deviceId || !type)
    return res.status(400).json({ error: 'deviceId and type required' });
  const entry = db.addAlert({ deviceId, type, message, meta });

  // If meta contains a blocked-number, track it.
  const blocked =
    (meta && (meta.blockedNumber || meta.number)) ||
    (type === 'blocked_call' && message);
  if (blocked) db.addBlockedNumber(deviceId, String(blocked));

  if (type === 'call_monitored') db.bumpCallsMonitored(1);
  res.json({ ok: true, entry });
});

// Pending commands (poll)
router.get('/devices/:id/commands', (req, res) => {
  const commands = db.getPendingCommands(req.params.id);
  res.json({ commands });
});

// Ack command
router.post('/devices/:id/commands/:cid/ack', (req, res) => {
  const ok = db.ackCommand(req.params.id, req.params.cid, req.body && req.body.result);
  res.json({ ok });
});

// Intruder photo upload
router.post('/intruders', upload.single('photo'), (req, res) => {
  const deviceId =
    req.body.deviceId || (req.file && req.file.filename) ? req.body.deviceId : null;
  if (!deviceId || !req.file)
    return res.status(400).json({ error: 'deviceId and photo required' });
  const entry = db.addIntruderPhoto({
    deviceId,
    filename: req.file.filename,
  });
  db.addAlert({
    deviceId,
    type: 'intruder_photo',
    message: 'Intruder photo captured',
    meta: { filename: req.file.filename },
  });
  res.json({ ok: true, entry });
});

// Serve uploaded photos publicly (so the device + admin can view).
router.get('/intruders/:filename', (req, res) => {
  const file = path.join(db.INTRUDERS_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

module.exports = router;
