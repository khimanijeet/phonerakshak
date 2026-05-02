const express = require('express');
const adminController = require('../controllers/adminController');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

router.get('/', requireAuth, adminController.getDashboard);
router.get('/devices', requireAuth, adminController.getDevices);
router.get('/devices/:id', requireAuth, adminController.getDevice);
router.post('/devices/:id/command', requireAuth, adminController.sendCommand);
router.post('/devices/:id/geofence', requireAuth, adminController.updateGeofence);
router.get('/blocked', requireAuth, adminController.getBlocked);
router.get('/reports', requireAuth, adminController.getReports);
router.get('/security', requireAuth, adminController.getSecurityLogs);

module.exports = router;
