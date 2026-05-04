const express = require('express');
const customerController = require('../controllers/customerController');

const router = express.Router();

const { requireCustomer } = customerController;

router.get('/login', customerController.getLogin);
router.post('/login', customerController.postLogin);
router.get('/register', customerController.getRegister);
router.post('/register', customerController.postRegister);
router.get('/logout', customerController.getLogout);

// Dashboard
router.get('/', requireCustomer, customerController.getDashboard);

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

module.exports = router;
