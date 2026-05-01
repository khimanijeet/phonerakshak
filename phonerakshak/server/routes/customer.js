const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function requireCustomer(req, res, next) {
  if (req.session && req.session.customer) return next();
  return res.redirect('/customer/login');
}

function isStrongEnough(password) {
  return typeof password === 'string' && password.length >= 6;
}

function normPhone(p) {
  return db.normalizePhone(p);
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' hr ago';
  return Math.floor(hr / 24) + ' day ago';
}

function buildCustomerContext(customer) {
  const devices = db.listCustomerDevices(customer.phone).map((d) => ({
    ...d,
    online: db.isOnline(d),
    lastSeenLabel: timeAgo(d.lastSeen),
  }));
  const device = devices[0] || null;
  let context = {
    devices, device, latest: null, alerts: [], photos: [], commands: [],
    simAlerts: [], protection: null, modeHistory: [],
  };
  if (device) {
    context.latest = db.getLatestLocation(device.deviceId);
    context.alerts = db.getAlerts(device.deviceId, 20);
    context.photos = db.getIntruderPhotos(device.deviceId, 6);
    context.commands = db.getCommands(device.deviceId, 8);
    context.simAlerts = db.getAlertsByType(device.deviceId, 'sim_change', 10);
    context.protection = db.getModeInfo(device);
    context.modeHistory = db.getModeHistory(device.deviceId, 6);
  }
  return context;
}

// ---------- Auth ----------
router.get('/login', (req, res) => {
  if (req.session && req.session.customer) return res.redirect('/customer');
  res.render('customer/login', { error: null, phone: '' });
});

router.post('/login', (req, res) => {
  const { phone, password } = req.body || {};
  const c = db.getCustomerByPhone(phone);
  if (!c || !bcrypt.compareSync(password || '', c.passwordHash)) {
    return res.status(401).render('customer/login', {
      error: 'Invalid phone number or password.',
      phone: phone || '',
    });
  }
  req.session.customer = { phone: c.phone, name: c.name };
  res.redirect('/customer');
});

router.get('/register', (req, res) => {
  res.render('customer/register', { error: null, form: { name: '', phone: '' } });
});

router.post('/register', (req, res) => {
  const { name, phone, password, confirmPassword } = req.body || {};
  const np = normPhone(phone);
  if (!np || np.replace(/\D/g, '').length < 7) {
    return res.status(400).render('customer/register', {
      error: 'Please enter a valid phone number.',
      form: { name, phone },
    });
  }
  if (!isStrongEnough(password)) {
    return res.status(400).render('customer/register', {
      error: 'Password must be at least 6 characters.',
      form: { name, phone },
    });
  }
  if (password !== confirmPassword) {
    return res.status(400).render('customer/register', {
      error: 'Passwords do not match.',
      form: { name, phone },
    });
  }
  if (db.getCustomerByPhone(np)) {
    return res.status(409).render('customer/register', {
      error: 'An account with this phone number already exists.',
      form: { name, phone },
    });
  }
  const c = db.createCustomer({
    phone: np,
    name: name || '',
    passwordHash: bcrypt.hashSync(password, 10),
  });
  req.session.customer = { phone: c.phone, name: c.name };
  res.redirect('/customer');
});

router.get('/logout', (req, res) => {
  if (req.session) delete req.session.customer;
  res.redirect('/customer/login');
});

// ---------- Dev-only auto-login for canvas previews ----------
router.get('/__preview-login', (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).send('Not found');
  const demoPhone = '+919811000222';
  const demoPass = 'demo1234';
  const passwordHash = bcrypt.hashSync(demoPass, 10);
  const { customer } = db.ensureDemoCustomer({
    phone: demoPhone,
    name: 'Aarav Sharma',
    passwordHash,
    deviceModel: 'Pixel 7',
  });
  req.session.customer = { phone: customer.phone, name: customer.name };
  const next =
    typeof req.query.next === 'string' && req.query.next.startsWith('/customer')
      ? req.query.next
      : '/customer';
  res.redirect(next);
});

// ---------- Dashboard ----------
router.get('/', requireCustomer, (req, res) => {
  const ctx = buildCustomerContext(req.session.customer);
  res.render('customer/dashboard', {
    user: req.session.customer,
    active: 'dashboard',
    ctx,
    notice: req.session.notice || null,
    timeAgo,
  });
  if (req.session.notice) delete req.session.notice;
});

router.post('/command', requireCustomer, (req, res) => {
  const { type } = req.body || {};
  const allowed = ['lock', 'unlock', 'alarm', 'stop_alarm', 'locate', 'emergency'];
  if (!allowed.includes(type)) {
    req.session.notice = { type: 'error', text: 'Unsupported command.' };
    return res.redirect('/customer');
  }
  const device = db.getCustomerPrimaryDevice(req.session.customer.phone);
  if (!device) {
    req.session.notice = {
      type: 'error',
      text: 'No device linked yet. Install the PhoneRakshak app and use the same phone number.',
    };
    return res.redirect('/customer');
  }
  db.queueCommand({ deviceId: device.deviceId, type });

  let extraNotice = '';
  if (type === 'emergency') {
    const latest = db.getLatestLocation(device.deviceId);
    const sent = db.notifyTrustedContacts(req.session.customer.phone, 'emergency', {
      deviceModel: device.deviceModel,
      ownerName: req.session.customer.name,
      latitude: latest && latest.latitude,
      longitude: latest && latest.longitude,
    });
    if (sent.length) {
      extraNotice = ` Trusted contacts notified (${sent.length}).`;
    }
  }

  const labels = {
    lock: 'Lock Device', unlock: 'Unlock Device',
    alarm: 'Play Alarm', stop_alarm: 'Stop Alarm',
    locate: 'Locate Device', emergency: 'Emergency Mode',
  };
  req.session.notice = {
    type: 'success',
    text: `${labels[type]} command sent — your phone will pick it up on next check-in.${extraNotice}`,
  };
  res.redirect('/customer');
});

// ---------- Protection mode ----------
router.post('/mode', requireCustomer, (req, res) => {
  const { mode } = req.body || {};
  if (!['normal', 'suspicious', 'theft'].includes(mode)) {
    req.session.notice = { type: 'error', text: 'Unsupported protection mode.' };
    return res.redirect('/customer');
  }
  const device = db.getCustomerPrimaryDevice(req.session.customer.phone);
  if (!device) {
    req.session.notice = { type: 'error', text: 'No device linked yet.' };
    return res.redirect('/customer');
  }
  const reason = mode === 'theft'
    ? 'Owner armed Theft Mode from the customer portal'
    : mode === 'normal'
    ? 'Owner stood the device down to Normal Mode'
    : 'Owner switched device to Suspicious Mode';
  db.setModeManual(device.deviceId, mode, reason, 'owner');
  if (mode === 'theft') {
    const latest = db.getLatestLocation(device.deviceId);
    db.notifyTrustedContacts(req.session.customer.phone, 'mode', {
      deviceModel: device.deviceModel,
      ownerName: req.session.customer.name,
      latitude: latest && latest.latitude,
      longitude: latest && latest.longitude,
    });
  }
  req.session.notice = {
    type: 'success',
    text: `Protection mode set to ${mode.toUpperCase()}.`,
  };
  res.redirect('/customer');
});

// ---------- Trusted contacts ----------
router.get('/contacts', requireCustomer, (req, res) => {
  const ownerPhone = req.session.customer.phone;
  const contacts = db.listTrustedContacts(ownerPhone);
  const notifications = db.listNotificationsFor(ownerPhone, 30);
  const ctx = buildCustomerContext(req.session.customer);
  const baseUrl = (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
  res.render('customer/contacts', {
    user: req.session.customer,
    active: 'contacts',
    ctx,
    contacts,
    notifications,
    baseUrl,
    error: req.session.contactsError || null,
    notice: req.session.contactsNotice || null,
    timeAgo,
  });
  delete req.session.contactsError;
  delete req.session.contactsNotice;
});

router.post('/contacts/add', requireCustomer, (req, res) => {
  const { name, phone, email } = req.body || {};
  const ownerPhone = req.session.customer.phone;
  if (!phone) {
    req.session.contactsError = 'Phone number is required.';
    return res.redirect('/customer/contacts');
  }
  if (db.listTrustedContacts(ownerPhone).length >= 5) {
    req.session.contactsError = 'You can add up to 5 trusted contacts.';
    return res.redirect('/customer/contacts');
  }
  const tc = db.addTrustedContact({ ownerPhone, name, phone, email });
  if (!tc) {
    req.session.contactsError = 'Please enter a valid phone number.';
  } else {
    req.session.contactsNotice = `${tc.name} added — they'll be alerted whenever you trigger Emergency Mode.`;
  }
  res.redirect('/customer/contacts');
});

router.post('/contacts/:id/delete', requireCustomer, (req, res) => {
  const ok = db.deleteTrustedContact(req.session.customer.phone, req.params.id);
  req.session.contactsNotice = ok ? 'Trusted contact removed.' : null;
  if (!ok) req.session.contactsError = 'Contact not found.';
  res.redirect('/customer/contacts');
});

router.get('/alerts', requireCustomer, (req, res) => {
  const ctx = buildCustomerContext(req.session.customer);
  res.render('customer/alerts', {
    user: req.session.customer,
    active: 'alerts',
    ctx,
    timeAgo,
  });
});

router.get('/photos', requireCustomer, (req, res) => {
  const ctx = buildCustomerContext(req.session.customer);
  const allPhotos = ctx.device
    ? db.getIntruderPhotos(ctx.device.deviceId, 60)
    : [];
  res.render('customer/photos', {
    user: req.session.customer,
    active: 'photos',
    ctx,
    photos: allPhotos,
    timeAgo,
  });
});

router.get('/account', requireCustomer, (req, res) => {
  const c = db.getCustomerByPhone(req.session.customer.phone);
  res.render('customer/account', {
    user: req.session.customer,
    active: 'account',
    customer: c,
    error: null,
    notice: null,
  });
});

router.post('/account/change-password', requireCustomer, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  const c = db.getCustomerByPhone(req.session.customer.phone);
  const render = (error, notice) =>
    res.render('customer/account', {
      user: req.session.customer,
      active: 'account',
      customer: c,
      error,
      notice,
    });
  if (!c) return res.redirect('/customer/login');
  if (!currentPassword || !newPassword || !confirmPassword)
    return render('All fields are required.', null);
  if (!bcrypt.compareSync(currentPassword, c.passwordHash))
    return render('Current password is incorrect.', null);
  if (!isStrongEnough(newPassword))
    return render('New password must be at least 6 characters.', null);
  if (newPassword !== confirmPassword)
    return render('New password and confirmation do not match.', null);
  db.updateCustomer(c.phone, { passwordHash: bcrypt.hashSync(newPassword, 10) });
  return render(null, 'Password updated successfully.');
});

router.post('/account/profile', requireCustomer, (req, res) => {
  const { name } = req.body || {};
  const c = db.updateCustomer(req.session.customer.phone, { name: name || '' });
  if (c) req.session.customer.name = c.name;
  res.render('customer/account', {
    user: req.session.customer,
    active: 'account',
    customer: c,
    error: null,
    notice: 'Profile saved.',
  });
});

module.exports = router;
