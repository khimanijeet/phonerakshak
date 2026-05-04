const Customer = require('../models/Customer');
const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const SecurityLog = require('../models/SecurityLog');
const bcrypt = require('bcryptjs');

const isOnline = (device, windowMs = 5 * 60 * 1000) => {
  return device && device.lastSeen && (Date.now() - new Date(device.lastSeen).getTime()) < windowMs;
};

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + ' hr ago';
  return Math.floor(hr / 24) + ' day ago';
}

async function buildCustomerContext(customerPhone) {
  const customer = await Customer.findOne({ phone: customerPhone }).lean();
  const isPremium = !!customer?.isPremium;
  
  const devicesDb = await Device.find({ phoneNumber: customerPhone }).sort({ lastSeen: -1 }).lean();
  const devices = devicesDb.map(d => ({
    ...d,
    online: isOnline(d),
    lastSeenLabel: timeAgo(d.lastSeen)
  }));
  
  const device = devices[0] || null;
  
  let context = {
    devices, device, latest: null, alerts: [], photos: [], commands: [],
    simAlerts: [], protection: null, modeHistory: [], activityLogs: [],
    isPremium
  };
  
  if (device) {
    const locs = await Location.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(1).lean();
    context.latest = locs[0] || null;
    
    context.alerts = await Alert.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(20).lean();
    context.photos = await Intruder.find({ deviceId: device.deviceId }).sort({ timestamp: -1 }).limit(6).lean();
    context.commands = await Command.find({ deviceId: device.deviceId }).sort({ queuedAt: -1 }).limit(8).lean();
    context.simAlerts = await Alert.find({ deviceId: device.deviceId, type: 'sim_change' }).sort({ timestamp: -1 }).limit(10).lean();
    
    // Assuming protection mode isn't explicitly defined in the Device schema right now, 
    // we just use a placeholder or read from a field if added later. 
    // For now we will mock it based on device properties.
    context.protection = {
      mode: 'normal', 
      reason: 'No active threats', 
      setBy: 'system', 
      since: Date.now()
    };
    
    let logs = [];
    context.alerts.forEach(a => logs.push({ type: a.type, timestamp: a.timestamp, message: a.message }));
    context.commands.forEach(c => {
      let msg = 'Command ' + c.type + ' executed';
      if (c.type === 'lock') msg = 'Device Locked';
      if (c.type === 'alarm') msg = 'Alarm Played';
      if (c.type === 'locate') msg = 'Location Requested';
      logs.push({ type: c.type, timestamp: c.queuedAt || c.timestamp || Date.now(), message: msg });
    });
    context.photos.forEach(p => logs.push({ type: 'photo', timestamp: p.timestamp, message: 'Intruder Photo Captured', image: p.filename || p.imageUrl }));
    if (context.latest) {
      logs.push({ type: 'location', timestamp: context.latest.timestamp, message: 'Location Updated' });
    }
    
    context.activityLogs = logs.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
  return context;
}

exports.requireCustomer = (req, res, next) => {
  if (req.session && req.session.customer) return next();
  return res.redirect('/customer/login');
};

exports.getLogin = (req, res) => {
  if (req.session && req.session.customer) return res.redirect('/customer');
  res.render('customer/login', { error: null, phone: '' });
};

exports.postLogin = async (req, res, next) => {
  try {
    const { phone, password } = req.body || {};
    const c = await Customer.findOne({ phone });
    if (!c || !bcrypt.compareSync(password || '', c.passwordHash)) {
      return res.status(401).render('customer/login', {
        error: 'Invalid phone number or password.',
        phone: phone || '',
      });
    }
    req.session.customer = { phone: c.phone, name: c.name };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.getRegister = (req, res) => {
  res.render('customer/register', { error: null, form: { name: '', phone: '' } });
};

exports.postRegister = async (req, res, next) => {
  try {
    const { name, phone, password, confirmPassword } = req.body || {};
    // basic norm
    const np = (phone || '').replace(/\D/g, '');
    if (np.length < 7) {
      return res.status(400).render('customer/register', {
        error: 'Please enter a valid phone number.', form: { name, phone },
      });
    }
    if (!password || password.length < 6) {
      return res.status(400).render('customer/register', {
        error: 'Password must be at least 6 characters.', form: { name, phone },
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).render('customer/register', {
        error: 'Passwords do not match.', form: { name, phone },
      });
    }
    
    const existing = await Customer.findOne({ phone: np });
    if (existing) {
      return res.status(409).render('customer/register', {
        error: 'An account with this phone number already exists.', form: { name, phone },
      });
    }
    
    const c = new Customer({
      phone: np,
      name: name || '',
      passwordHash: bcrypt.hashSync(password, 10),
    });
    await c.save();
    
    req.session.customer = { phone: c.phone, name: c.name };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.getLogout = (req, res) => {
  if (req.session) delete req.session.customer;
  res.redirect('/customer/login');
};

exports.getDashboard = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    const ctx = await buildCustomerContext(req.session.customer.phone);
    res.render('customer/dashboard', {
      user: c || req.session.customer,
      active: 'dashboard',
      ctx,
      notice: req.session.notice || null,
      timeAgo,
    });
    if (req.session.notice) delete req.session.notice;
  } catch (err) { next(err); }
};

exports.getSecurity = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    const ctx = await buildCustomerContext(req.session.customer.phone);
    res.render('customer/security', {
      user: c || req.session.customer,
      active: 'security',
      ctx,
      notice: req.session.notice || null,
      timeAgo,
    });
    if (req.session.notice) delete req.session.notice;
  } catch (err) { next(err); }
};

exports.getActivity = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    const ctx = await buildCustomerContext(req.session.customer.phone);
    res.render('customer/activity', {
      user: c || req.session.customer,
      active: 'activity',
      ctx,
      notice: req.session.notice || null,
      timeAgo,
    });
    if (req.session.notice) delete req.session.notice;
  } catch (err) { next(err); }
};

exports.getSettings = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    const ctx = await buildCustomerContext(req.session.customer.phone);
    res.render('customer/settings', {
      user: c || req.session.customer,
      active: 'settings',
      ctx,
      notice: req.session.notice || null,
      timeAgo,
    });
    if (req.session.notice) delete req.session.notice;
  } catch (err) { next(err); }
};

exports.postUpdateSettings = async (req, res, next) => {
  try {
    const phone = req.session.customer.phone;
    const c = await Customer.findOne({ phone });
    
    if (!c.settings) c.settings = {};
    
    c.settings.pushNotifications = req.body.pushNotifications === 'on';
    c.settings.alertSounds = req.body.alertSounds === 'on';
    c.settings.dataSync = req.body.dataSync === 'on';
    c.settings.locationSharing = req.body.locationSharing === 'on';
    c.settings.autoBackup = req.body.autoBackup === 'on';
    c.settings.advancedAlerts = req.body.advancedAlerts === 'on';
    
    await c.save();
    res.redirect('/customer/settings');
  } catch (err) { next(err); }
};

exports.getPoll = async (req, res, next) => {
  try {
    const ctx = await buildCustomerContext(req.session.customer.phone);
    res.json({ latest: ctx.latest, activityLogs: ctx.activityLogs.slice(0, 10), alerts: ctx.alerts });
  } catch (err) { next(err); }
};

exports.postCommand = async (req, res, next) => {
  try {
    const { type } = req.body || {};
    const allowed = ['lock', 'unlock', 'alarm', 'stop_alarm', 'locate', 'emergency'];
    if (!allowed.includes(type)) {
      req.session.notice = { type: 'error', text: 'Unsupported command.' };
      return res.redirect('/customer');
    }
    const device = await Device.findOne({ phoneNumber: req.session.customer.phone }).sort({ lastSeen: -1 });
    if (!device) {
      req.session.notice = { type: 'error', text: 'No device linked yet. Install the PhoneRakshak app and use the same phone number.' };
      return res.redirect('/customer');
    }
    
    // Create command
    await Command.create({ deviceId: device.deviceId, type, status: 'queued', queuedAt: Date.now() });
    
    // Attempt instant delivery via FCM (could be implemented later if required, skipping for brevity, we queue it)
    
    const labels = { lock: 'Lock Device', unlock: 'Unlock Device', alarm: 'Play Alarm', stop_alarm: 'Stop Alarm', locate: 'Locate Device', emergency: 'Emergency Mode' };
    req.session.notice = { type: 'success', text: `${labels[type]} command sent — your phone will pick it up on next check-in.` };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.postMode = async (req, res, next) => {
  try {
    const { mode } = req.body || {};
    if (!['normal', 'suspicious', 'theft'].includes(mode)) {
      req.session.notice = { type: 'error', text: 'Unsupported protection mode.' };
      return res.redirect('/customer');
    }
    const device = await Device.findOne({ phoneNumber: req.session.customer.phone }).sort({ lastSeen: -1 });
    if (!device) {
      req.session.notice = { type: 'error', text: 'No device linked yet.' };
      return res.redirect('/customer');
    }
    
    // For now we just create a security log or alert
    await Alert.create({ deviceId: device.deviceId, type: 'mode_change', message: `Protection mode set to ${mode.toUpperCase()} by owner`, timestamp: Date.now() });
    
    req.session.notice = { type: 'success', text: `Protection mode set to ${mode.toUpperCase()}.` };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.getContacts = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone }).lean();
    const contacts = c.trustedContacts || [];
    const notifications = []; // Mock notifications
    const ctx = await buildCustomerContext(req.session.customer.phone);
    const baseUrl = (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
    res.render('customer/contacts', {
      user: c || req.session.customer,
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
  } catch (err) { next(err); }
};

exports.postAddContact = async (req, res, next) => {
  try {
    const { name, phone, email } = req.body || {};
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    if (!phone) {
      req.session.contactsError = 'Phone number is required.';
      return res.redirect('/customer/contacts');
    }
    if (c.trustedContacts.length >= 5) {
      req.session.contactsError = 'You can add up to 5 trusted contacts.';
      return res.redirect('/customer/contacts');
    }
    c.trustedContacts.push({ name, phone, email });
    await c.save();
    req.session.contactsNotice = `${name} added — they'll be alerted whenever you trigger Emergency Mode.`;
    res.redirect('/customer/contacts');
  } catch (err) { next(err); }
};

exports.postDeleteContact = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    c.trustedContacts = c.trustedContacts.filter(tc => tc._id.toString() !== req.params.id);
    await c.save();
    req.session.contactsNotice = 'Trusted contact removed.';
    res.redirect('/customer/contacts');
  } catch (err) { next(err); }
};

exports.getAlerts = async (req, res, next) => {
  try {
    const ctx = await buildCustomerContext(req.session.customer.phone);
    res.render('customer/alerts', { user: req.session.customer, active: 'alerts', ctx, timeAgo });
  } catch (err) { next(err); }
};

exports.getPhotos = async (req, res, next) => {
  try {
    const ctx = await buildCustomerContext(req.session.customer.phone);
    const photos = ctx.device ? await Intruder.find({ deviceId: ctx.device.deviceId }).sort({ timestamp: -1 }).limit(60).lean() : [];
    res.render('customer/photos', { user: req.session.customer, active: 'photos', ctx, photos, timeAgo });
  } catch (err) { next(err); }
};

exports.getAccount = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone }).lean();
    res.render('customer/account', { user: req.session.customer, active: 'account', customer: c, error: null, notice: null });
  } catch (err) { next(err); }
};

exports.postChangePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    const render = (error, notice) => res.render('customer/account', { user: req.session.customer, active: 'account', customer: c, error, notice });
    
    if (!c) return res.redirect('/customer/login');
    if (!currentPassword || !newPassword || !confirmPassword) return render('All fields are required.', null);
    if (!bcrypt.compareSync(currentPassword, c.passwordHash)) return render('Current password is incorrect.', null);
    if (newPassword.length < 6) return render('New password must be at least 6 characters.', null);
    if (newPassword !== confirmPassword) return render('New password and confirmation do not match.', null);
    
    c.passwordHash = bcrypt.hashSync(newPassword, 10);
    await c.save();
    return render(null, 'Password updated successfully.');
  } catch (err) { next(err); }
};

exports.postProfile = async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    c.name = name || '';
    await c.save();
    req.session.customer.name = c.name;
    res.render('customer/account', { user: req.session.customer, active: 'account', customer: c, error: null, notice: 'Profile saved.' });
  } catch (err) { next(err); }
};
