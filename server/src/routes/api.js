const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const apiController = require('../controllers/apiController');

const router = express.Router();

const INTRUDERS_DIR = path.join(__dirname, '../../data/intruders');
if (!fs.existsSync(INTRUDERS_DIR)) {
  fs.mkdirSync(INTRUDERS_DIR, { recursive: true });
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

router.post('/devices', apiController.upsertDevice);
router.post('/devices/:id/ping', apiController.pingDevice);
router.post('/locations', apiController.addLocation);
router.post('/alerts', apiController.addAlert);
router.get('/devices/:id/commands', apiController.getCommands);
router.post('/devices/:id/commands/:cid/ack', apiController.ackCommand);
router.post('/intruders', upload.single('photo'), apiController.addIntruder);

router.get('/intruders/:filename', (req, res) => {
  const file = path.join(INTRUDERS_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

module.exports = router;
