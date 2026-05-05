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
  const plan = customer.plan || 'free';
  const planFeatures = db.PLAN_FEATURES[plan] || db.PLAN_FEATURES['free'];
  
  let context = {
    devices, device, latest: null, alerts: [], photos: [], commands: [],
    simAlerts: [], protection: null, modeHistory: [], activityLogs: [],
    plan, planFeatures
  };
  if (device) {
    context.latest = db.getLatestLocation(device.deviceId);
    context.alerts = db.getAlerts(device.deviceId, 20);
    context.photos = db.getIntruderPhotos(device.deviceId, 6);
    context.commands = db.getCommands(device.deviceId, 8);
    context.simAlerts = db.getAlertsByType(device.deviceId, 'sim_change', 10);
    context.protection = db.getModeInfo(device);
    context.modeHistory = db.getModeHistory(device.deviceId, 6);
    
    // Derive activityLogs
    let logs = [];
    context.alerts.forEach(a => logs.push({ type: a.type, timestamp: a.timestamp, message: a.message }));
    context.commands.forEach(c => {
      let msg = 'Command ' + c.type + ' executed';
      if (c.type === 'lock') msg = 'Device Locked';
      if (c.type === 'alarm') msg = 'Alarm Played';
      if (c.type === 'locate') msg = 'Location Requested';
      logs.push({ type: c.type, timestamp: c.queuedAt || c.timestamp || Date.now(), message: msg });
    });
    context.photos.forEach(p => logs.push({ type: 'photo', timestamp: p.timestamp, message: 'Intruder Photo Captured', image: p.filename }));
    if (context.latest) {
      logs.push({ type: 'location', timestamp: context.latest.timestamp, message: 'Location Updated' });
    }
    
    context.activityLogs = logs.sort((a,b) => b.timestamp - a.timestamp);
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
  const demoPhone = '9811000222';
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

router.post('/settings/update', requireCustomer, (req, res) => {
  const phone = req.session.customer.phone;
  const currentCustomer = db.getCustomerByPhone(phone);
  const settings = currentCustomer.settings || {};
  
  settings.pushNotifications = req.body.pushNotifications === 'on';
  settings.alertSounds = req.body.alertSounds === 'on';
  settings.dataSync = req.body.dataSync === 'on';
  settings.locationSharing = req.body.locationSharing === 'on';
  settings.autoBackup = req.body.autoBackup === 'on';
  settings.advancedAlerts = req.body.advancedAlerts === 'on';
  
  db.updateCustomer(phone, { settings });
  
  res.redirect('/customer/settings');
});

// ---------- Device Commands ----------
router.get('/', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const c = dbCustomer || req.session.customer;
  const ctx = buildCustomerContext(c);
  res.render('customer/dashboard', {
    user: c,
    active: 'dashboard',
    ctx,
    notice: req.session.notice || null,
    timeAgo,
  });
  if (req.session.notice) delete req.session.notice;
});

router.get('/security', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const c = dbCustomer || req.session.customer;
  const ctx = buildCustomerContext(c);
  res.render('customer/security', {
    user: c,
    active: 'security',
    ctx,
    notice: req.session.notice || null,
    timeAgo,
  });
  if (req.session.notice) delete req.session.notice;
});

router.get('/activity', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const c = dbCustomer || req.session.customer;
  const ctx = buildCustomerContext(c);
  res.render('customer/activity', {
    user: c,
    active: 'activity',
    ctx,
    notice: req.session.notice || null,
    timeAgo,
  });
  if (req.session.notice) delete req.session.notice;
});

router.get('/settings', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const c = dbCustomer || req.session.customer;
  const ctx = buildCustomerContext(c);
  res.render('customer/settings', {
    user: c,
    active: 'settings',
    ctx,
    notice: req.session.notice || null,
    timeAgo,
  });
  if (req.session.notice) delete req.session.notice;
});

// ---------- Polling ----------
router.get('/api/poll', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const ctx = buildCustomerContext(dbCustomer || req.session.customer);
  res.json({ latest: ctx.latest, activityLogs: ctx.activityLogs.slice(0, 10), alerts: ctx.alerts });
});

router.post('/command', requireCustomer, (req, res) => {
  const { type } = req.body || {};
  const allowed = ['lock', 'unlock', 'alarm', 'stop_alarm', 'locate', 'emergency'];
  if (!allowed.includes(type)) {
    req.session.notice = { type: 'error', text: 'Unsupported command.' };
    return res.redirect('/customer');
  }

  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const plan = dbCustomer.plan || 'free';
  const features = db.PLAN_FEATURES[plan] || db.PLAN_FEATURES['free'];
  
  if ((type === 'lock' || type === 'unlock') && !features.remoteLock) {
     req.session.notice = { type: 'error', text: 'Remote Lock requires Basic Plan or higher. Please upgrade.' };
     return res.redirect('/customer/pricing');
  }
  if (type === 'emergency' && plan !== 'premium' && plan !== 'pro') {
     req.session.notice = { type: 'error', text: 'Emergency Mode requires Premium Plan or higher. Please upgrade.' };
     return res.redirect('/customer/pricing');
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
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const ctx = buildCustomerContext(dbCustomer || req.session.customer);
  
  if (!ctx.planFeatures.intruderSelfie) {
    req.session.notice = { type: 'error', text: 'Intruder Photos require Premium Plan or higher. Please upgrade.' };
    return res.redirect('/customer/pricing');
  }

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

// ---------- Pricing & Plans ----------
router.get('/pricing', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const c = dbCustomer || req.session.customer;
  const ctx = buildCustomerContext(c);
  res.render('customer/pricing', {
    user: c,
    active: 'pricing',
    ctx,
    notice: req.session.notice || null,
    timeAgo,
  });
  if (req.session.notice) delete req.session.notice;
});

router.post('/upgrade', requireCustomer, (req, res) => {
  const { plan } = req.body || {};
  const allowedPlans = ['free', 'basic', 'premium', 'pro'];
  if (!allowedPlans.includes(plan)) {
    req.session.notice = { type: 'error', text: 'Invalid plan selected.' };
    return res.redirect('/customer/pricing');
  }

  const phone = req.session.customer.phone;
  db.updateCustomer(phone, { plan });
  
  req.session.notice = { type: 'success', text: `Successfully upgraded to ${plan.toUpperCase()} plan.` };
  res.redirect('/customer');
});

// ---------- Support ----------
router.get('/support', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const c = dbCustomer || req.session.customer;
  const ctx = buildCustomerContext(c);
  res.render('customer/support', {
    user: c,
    active: 'support',
    ctx,
    timeAgo,
  });
});

router.get('/api/support/history', requireCustomer, (req, res) => {
  const tkt = db.getSupportTicket(req.session.customer.phone);
  if (!tkt) {
    return res.json({ messages: [], status: 'open', priority: 'normal', botResponseCount: 0 });
  }
  res.json({ messages: tkt.messages, status: tkt.status, priority: tkt.priority, botResponseCount: tkt.botResponseCount });
});

router.post('/api/support/chat', requireCustomer, (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Message required' });
  
  // Add user message
  let tkt = db.addSupportMessage(req.session.customer.phone, text, false);
  
  // Bot logic
  if (tkt && tkt.status !== 'escalated') {
    let botReply = '';
    const lowerText = text.toLowerCase();
    
    // Quick options handling
    if (lowerText.includes('lost phone') || lowerText.includes('track location')) {
      botReply = 'If your phone is lost, you can use the "Locate" command from your dashboard to find its GPS coordinates. You can also "Lock" it to protect your data.';
    } else if (lowerText.includes('lock device')) {
      botReply = 'You can lock your device remotely by clicking the "Lock Phone" button on the dashboard or sidebar.';
    } else if (lowerText.includes('alarm not working')) {
      botReply = 'Please ensure the PhoneRakshak app has "Do Not Disturb" bypass permissions enabled in your phone settings.';
    } else if (lowerText.includes('sim changed')) {
      botReply = 'A SIM change alert means someone removed your SIM card. Your trusted contacts should have received an SMS with the new number.';
    } else if (tkt.messages.length <= 2) {
      botReply = 'Hi 👋 How can I help you today? I can assist you with common issues or connect you to our support team.';
    } else {
      botReply = 'I understand. Please let me know more details, or you can talk to a human agent.';
    }
    
    if (botReply) {
      tkt = db.addSupportMessage(req.session.customer.phone, botReply, true);
    }
  }
  
  res.json({ messages: tkt.messages, status: tkt.status, priority: tkt.priority, botResponseCount: tkt.botResponseCount });
});

router.post('/api/support/escalate', requireCustomer, (req, res) => {
  const dbCustomer = db.getCustomerByPhone(req.session.customer.phone);
  const plan = dbCustomer ? (dbCustomer.plan || 'free') : 'free';
  const isPremium = plan === 'premium' || plan === 'pro';
  
  let tkt = db.getSupportTicket(req.session.customer.phone);
  if (!tkt || tkt.status === 'escalated') {
    return res.json({ success: false, message: 'Ticket already escalated or not found.' });
  }

  tkt = db.escalateTicket(req.session.customer.phone, isPremium);
  
  let escalateMsg = isPremium 
    ? 'Connecting you to priority support...' 
    : 'Our team will respond within 24 hours';
    
  // Add the escalation confirmation as a bot message
  tkt = db.addSupportMessage(req.session.customer.phone, escalateMsg, true);
  
  res.json({ success: true, message: escalateMsg, priority: tkt.priority, botResponseCount: tkt.botResponseCount });
});

module.exports = router;
