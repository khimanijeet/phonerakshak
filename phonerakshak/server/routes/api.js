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
  const { deviceId, phoneNumber, emergencyNumber, deviceModel, city, batteryLevel, appVersion } =
    req.body || {};
  if (!deviceId)
    return res.status(400).json({ error: 'deviceId required' });
  const device = db.upsertDevice({
    deviceId,
    phoneNumber,
    emergencyNumber,
    deviceModel,
    city,
    batteryLevel,
    appVersion,
  });
  res.json({ ok: true, device });
});

// Heartbeat
router.post('/devices/:id/ping', (req, res) => {
  const { batteryLevel, appVersion } = req.body || {};
  db.touchDevice(req.params.id, { batteryLevel, appVersion });
  res.json({ ok: true });
});

// Locations — accepts GPS lat/lng OR a list of nearby WiFi APs / cell towers.
// Server picks the best available source in the order GPS → WiFi → Cell.
router.post('/locations', (req, res) => {
  const { deviceId, trigger, wifiAps, cellTowers } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  const resolved = db.resolveLocationPayload(req.body);
  if (!resolved) {
    return res.status(422).json({
      error: 'Could not resolve location: provide latitude/longitude, known wifiAps, or known cellTowers',
    });
  }
  const entry = db.addLocation({
    deviceId,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    accuracy: resolved.accuracy,
    trigger,
    source: resolved.source,
    contributors: resolved.contributors,
  });
  res.json({ ok: true, entry, source: resolved.source });
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

// Pending commands (poll). Also returns the active protection mode + recommended
// ping interval, so the Android client can dynamically self-tune to the mode
// (Normal / Suspicious / Theft) without a separate request.
router.get('/devices/:id/commands', (req, res) => {
  const commands = db.getPendingCommands(req.params.id);
  const device = db.getDevice ? db.getDevice(req.params.id) : null;
  // db.getDevice may not exist; fall back to direct lookup via listDevices
  const dev = device || db.listDevices().find((d) => d.deviceId === req.params.id) || null;
  res.json({
    commands,
    mode: dev ? db.getModeInfo(dev) : null,
  });
});

// Manual mode switch (used by the Android app, e.g. when the user disarms theft
// mode after recovering the phone, or when an in-app rule wants to escalate).
router.post('/devices/:id/mode', (req, res) => {
  const { mode, reason } = req.body || {};
  if (!['normal', 'suspicious', 'theft'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be normal | suspicious | theft' });
  }
  const dev = db.setModeManual(req.params.id, mode, reason, 'device');
  if (!dev) return res.status(404).json({ error: 'device not found' });
  res.json({ ok: true, mode: db.getModeInfo(dev) });
});

// Ack command
router.post('/devices/:id/commands/:cid/ack', (req, res) => {
  const ok = db.ackCommand(req.params.id, req.params.cid, req.body && req.body.result);
  res.json({ ok });
});

// Wi-Fi snapshot (last connected access point)
router.post('/wifi', (req, res) => {
  const {
    deviceId,
    ssid,
    bssid,
    rssi,
    linkSpeedMbps,
    frequencyMhz,
    capturedAt,
    trigger,
  } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  if (!ssid && !bssid)
    return res.status(400).json({ error: 'ssid or bssid required' });
  const entry = db.addWifiSnapshot({
    deviceId,
    ssid,
    bssid,
    rssi,
    linkSpeedMbps,
    frequencyMhz,
    capturedAt,
    trigger,
  });
  res.json({ ok: true, entry });
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
