const express = require('express');
const customerController = require('../controllers/customerController');

const router = express.Router();

const { requireCustomer } = customerController;



router.get('/login', customerController.getLogin);
router.post('/login', customerController.postLoginFirebase);
router.get('/forgot-password', customerController.getForgotPassword);
router.post('/reset-password-firebase', customerController.postResetPasswordFirebase);
router.get('/register', customerController.getRegister);
router.post('/register', customerController.postRegister);
router.get('/logout', customerController.getLogout);

// Dashboard & Tabs
router.get('/', requireCustomer, customerController.getDashboard);
router.get('/security', requireCustomer, customerController.getSecurity);
router.get('/activity', requireCustomer, customerController.getActivity);
router.get('/settings', requireCustomer, customerController.getSettings);
router.post('/settings/update', requireCustomer, customerController.postUpdateSettings);

// Polling
router.get('/api/poll', requireCustomer, customerController.getPoll);

// Command & Protection mode
router.post('/command', requireCustomer, customerController.postCommand);
router.post('/mode', requireCustomer, customerController.postMode);

// Contacts
router.get('/contacts', requireCustomer, customerController.getContacts);
router.post('/contacts/add', requireCustomer, customerController.postAddContact);
router.post('/contacts/:id/delete', requireCustomer, customerController.postDeleteContact);

// Alerts & Photos
router.get('/alerts', requireCustomer, customerController.getAlerts);
router.get('/photos', requireCustomer, customerController.getPhotos);

// Account & Profile
router.get('/account', requireCustomer, customerController.getAccount);
router.post('/account/change-password', requireCustomer, customerController.postChangePassword);
router.post('/account/profile', requireCustomer, customerController.postProfile);

// Support
router.get('/support', requireCustomer, customerController.getSupport);
router.post('/api/support/chat', requireCustomer, customerController.postSupportChat);
router.post('/api/support/escalate', requireCustomer, customerController.postSupportEscalate);
router.get('/api/support/history', requireCustomer, customerController.getSupportHistory);

module.exports = router;
