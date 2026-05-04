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
router.get('/setup-2fa', requireAuth, adminController.getSetup2FA);
router.post('/setup-2fa', requireAuth, adminController.postSetup2FA);
router.post('/disable-2fa', requireAuth, adminController.disable2FA);

// New Routes for sidebar links
router.get('/users', requireAuth, adminController.getUsers);
router.get('/subscriptions', requireAuth, adminController.getSubscriptions);
router.get('/sim', requireAuth, adminController.getSim);
router.get('/plans', requireAuth, adminController.getPlans);
router.get('/alerts', requireAuth, adminController.getAlerts); // Renamed from /reports
router.get('/logs', requireAuth, adminController.getLogs); // Renamed from /security
router.get('/lock-alarm', requireAuth, adminController.getLockAlarm);
router.get('/geofence', requireAuth, adminController.getGeofence);
router.get('/commands', requireAuth, adminController.getCommands);
router.get('/health', requireAuth, adminController.getHealth);
router.get('/account', requireAuth, adminController.getAccount);
router.get('/broadcast', requireAuth, adminController.getBroadcast);
router.post('/broadcast', requireAuth, adminController.postBroadcast);
router.get('/support', requireAuth, adminController.getSupport);

// Support API endpoints
router.get('/api/support/tickets', requireAuth, adminController.getApiTickets);
router.get('/api/support/history', requireAuth, adminController.getApiTicketHistory);
router.post('/api/support/chat', requireAuth, adminController.postApiSupportChat);
router.patch('/api/support/ticket/:id/status', requireAuth, adminController.patchApiTicketStatus);

module.exports = router;
