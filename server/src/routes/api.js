const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const apiController = require('../controllers/apiController');
const { verifyToken, requireActiveUser } = require('../middlewares/auth');

const router = express.Router();

const INTRUDERS_DIR = path.join(__dirname, '../../data/intruders');
if (!fs.existsSync(INTRUDERS_DIR)) {
  fs.mkdirSync(INTRUDERS_DIR, { recursive: true });
}

const AUDIO_DIR = path.join(__dirname, '../../data/audio');
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INTRUDERS_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.amr`;
    cb(null, safe);
  },
});
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for audio
});

// Open route for registration/refresh (returns JWT)
router.post('/auth/firebase-login', apiController.firebaseLogin);
router.post('/devices', apiController.openRegister);
router.post('/device/register', verifyToken, requireActiveUser, apiController.upsertDevice);
router.post('/device/register-fcm', verifyToken, requireActiveUser, apiController.registerFcm);

// Face Recovery Setup & Verification
router.post('/auth/register-face', apiController.registerFace);
router.post('/auth/verify-face', apiController.verifyFace);

// Subscription Routes
router.get('/subscription/current', verifyToken, requireActiveUser, apiController.getCurrentSubscription);
router.post('/subscription/upgrade', apiController.upgradeSubscription);
router.post('/subscription/downgrade', apiController.downgradeSubscription);

// Protected routes
router.post('/devices/:id/ping', verifyToken, requireActiveUser, apiController.pingDevice);
router.post('/locations', verifyToken, requireActiveUser, apiController.addLocation);
router.post('/alerts', verifyToken, requireActiveUser, apiController.addAlert);
router.get('/devices/:id/commands', verifyToken, requireActiveUser, apiController.getCommands);
router.post('/device/ack', verifyToken, requireActiveUser, apiController.ackCommand);
router.get('/devices/:id/geofence', verifyToken, requireActiveUser, apiController.getGeofence);
router.post('/intruders', verifyToken, requireActiveUser, upload.single('photo'), apiController.addIntruder);
router.post('/support/chat', verifyToken, requireActiveUser, apiController.postSupportChat);
router.post('/audio', verifyToken, requireActiveUser, uploadAudio.single('audio'), apiController.addAudio);

router.get('/intruders/:filename', (req, res) => {
  const file = path.join(INTRUDERS_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

router.get('/audio/:filename', (req, res) => {
  const file = path.join(AUDIO_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

module.exports = router;

