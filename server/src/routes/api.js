const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const apiController = require('../controllers/apiController');
const { verifyToken } = require('../middlewares/auth');

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
router.post('/devices', apiController.upsertDevice);

// Face Recovery Setup & Verification
router.post('/auth/register-face', apiController.registerFace);
router.post('/auth/verify-face', apiController.verifyFace);

// Protected routes
router.post('/devices/:id/ping', verifyToken, apiController.pingDevice);
router.post('/locations', verifyToken, apiController.addLocation);
router.post('/alerts', verifyToken, apiController.addAlert);
router.get('/devices/:id/commands', verifyToken, apiController.getCommands);
router.post('/devices/:id/commands/:cid/ack', verifyToken, apiController.ackCommand);
router.get('/devices/:id/geofence', verifyToken, apiController.getGeofence);
router.post('/intruders', verifyToken, upload.single('photo'), apiController.addIntruder);
router.post('/audio', verifyToken, uploadAudio.single('audio'), apiController.addAudio);

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
