const Customer = require('../models/Customer');
const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const SecurityLog = require('../models/SecurityLog');
const SupportTicket = require('../models/SupportTicket');
const bcrypt = require('bcryptjs');
const { sendAndroidPushAlert } = require('../utils/firebase');
const { generateSupportResponse } = require('../utils/gemini');

const getFirebaseConfig = () => ({
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || ''
});

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

async function buildCustomerContext(customerPhone, activeDeviceId = null) {
  const customer = await Customer.findOne({ phone: customerPhone }).lean();
  const plan = customer?.plan || 'free';
  
  const devicesDb = await Device.find({ phoneNumber: customerPhone }).sort({ lastSeen: -1 }).lean();
  const devices = devicesDb.map(d => ({
    ...d,
    online: isOnline(d),
    lastSeenLabel: timeAgo(d.lastSeen),
    displayName: d.deviceName || d.deviceModel || 'Unknown Device'
  }));
  
  let device = null;
  if (devices.length > 0) {
    if (activeDeviceId) {
      device = devices.find(d => d.deviceId === activeDeviceId) || devices[0];
    } else {
      device = devices[0];
    }
  }
  
  let context = {
    devices, device, latest: null, alerts: [], photos: [], commands: [],
    simAlerts: [], protection: null, modeHistory: [], activityLogs: [],
    plan
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
  if (!req.session.customer) return res.redirect('/customer/login');
  next();
};

exports.requirePlan = (requiredPlan) => {
  return async (req, res, next) => {
    try {
      const Customer = require('../models/Customer');
      const phone = req.session?.customer?.phone || req.userId;
      if (!phone) {
        if (req.session) { req.session.notice = { type: 'error', text: 'Authentication required' }; return res.redirect('/customer'); }
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      let customer;
      if (phone.toString().length > 20) { // Probably an ID
        customer = await Customer.findById(phone);
      } else {
        customer = await Customer.findOne({ phone });
      }
      
      if (!customer) return res.status(404).json({ error: 'Account not found' });
      
      const planValue = { free: 0, plus: 1, premium: 2 };
      const currentPlan = customer.plan || 'free';
      
      if (planValue[currentPlan] < planValue[requiredPlan]) {
        if (req.session && req.session.customer) {
          req.session.notice = { type: 'error', text: `This feature requires the ${requiredPlan.toUpperCase()} plan.` };
          return res.redirect('back');
        } else {
          return res.status(403).json({ error: `Feature requires ${requiredPlan} plan. Current plan: ${currentPlan}` });
        }
      }
      next();
    } catch (err) { next(err); }
  };
};

exports.getLogin = (req, res) => {
  if (req.session && req.session.customer) return res.redirect('/customer');
  res.render('customer/login', { 
    error: null, 
    phone: '',
    firebaseConfig: getFirebaseConfig() 
  });
};

exports.postLogin = async (req, res, next) => {
  try {
    const { phone, password } = req.body || {};
    const c = await Customer.findOne({ phone });
    if (!c || !c.passwordHash || !bcrypt.compareSync(password || '', c.passwordHash)) {
      return res.status(401).render('customer/login', {
        error: 'Invalid phone number or password. If you registered via the app, you must reset your password first.',
        phone: phone || '',
        firebaseConfig: getFirebaseConfig()
      });
    }
    req.session.customer = { phone: c.phone, name: c.name };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.getForgotPassword = (req, res) => {
  res.render('customer/forgot-password', { 
    error: null, 
    success: null, 
    phone: '',
    firebaseConfig: getFirebaseConfig()
  });
};

exports.postResetPasswordFirebase = async (req, res, next) => {
  try {
    const { idToken, newPassword } = req.body || {};
    
    if (!idToken || !newPassword) {
      return res.status(400).json({ success: false, error: 'Token and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }

    const admin = require('firebase-admin');
    const logger = require('../utils/logger');
    
    let decodedToken;
    try {
      if (admin.apps.length > 0) {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } else {
        logger.warn('Firebase Admin not initialized. Accepting mock token.');
        if (idToken.startsWith('mock-token-')) {
          const phone = idToken.split('mock-token-')[1];
          decodedToken = { phone_number: phone };
        } else {
          return res.status(500).json({ success: false, error: 'Firebase Admin not configured.' });
        }
      }
    } catch (error) {
      logger.error('Firebase token verification failed: ' + error.message);
      return res.status(401).json({ success: false, error: 'Invalid or expired OTP token.' });
    }

    const { phone_number } = decodedToken;
    if (!phone_number) {
      return res.status(400).json({ success: false, error: 'No phone number associated with this token.' });
    }

    const cleanedPhone = phone_number.replace(/\D/g, '');
    const c = await Customer.findOne({ phone: cleanedPhone });
    
    if (!c) {
      return res.status(404).json({ success: false, error: 'No account found for this phone number.' });
    }

    c.passwordHash = bcrypt.hashSync(newPassword, 10);
    await c.save();

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) { next(err); }
};

exports.getRegister = (req, res) => {
  res.render('customer/register', { 
    error: null, 
    form: { name: '', phone: '' },
    firebaseConfig: getFirebaseConfig()
  });
};

exports.postLoginFirebase = async (req, res, next) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).send('Token required');

    const admin = require('firebase-admin');
    let decodedToken;
    
    if (admin.apps.length > 0) {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } else {
      // Fallback for dev if firebase-admin isn't init
      if (idToken.startsWith('mock-token-')) {
        decodedToken = { phone_number: idToken.split('mock-token-')[1] };
      } else {
        return res.status(500).send('Auth service unavailable');
      }
    }

    const { phone_number } = decodedToken;
    if (!phone_number) return res.status(400).send('Invalid token data');

    const cleanedPhone = phone_number.replace(/\D/g, '');
    let c = await Customer.findOne({ phone: cleanedPhone });
    
    if (!c) {
      // Auto-register if user doesn't exist but verified via OTP
      c = new Customer({
        phone: cleanedPhone,
        name: 'New User',
        plan: 'free'
      });
      await c.save();
    }

    req.session.customer = { phone: c.phone, name: c.name };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.postRegister = async (req, res, next) => {
  try {
    const { name, phone, password, confirmPassword } = req.body || {};
    // basic norm
    const np = (phone || '').replace(/\D/g, '');
    if (np.length < 7) {
      return res.status(400).render('customer/register', {
        error: 'Please enter a valid phone number.', form: { name, phone },
        firebaseConfig: getFirebaseConfig()
      });
    }
    if (!password || password.length < 6) {
      return res.status(400).render('customer/register', {
        error: 'Password must be at least 6 characters.', form: { name, phone },
        firebaseConfig: getFirebaseConfig()
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).render('customer/register', {
        error: 'Passwords do not match.', form: { name, phone },
        firebaseConfig: getFirebaseConfig()
      });
    }
    
    const existing = await Customer.findOne({ phone: np });
    if (existing) {
      return res.status(409).render('customer/register', {
        error: 'An account with this phone number already exists.', form: { name, phone },
        firebaseConfig: getFirebaseConfig()
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
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
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
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
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
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
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
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
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
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
    res.json({ latest: ctx.latest, activityLogs: ctx.activityLogs.slice(0, 10), alerts: ctx.alerts });
  } catch (err) { next(err); }
};

exports.postCommand = async (req, res, next) => {
  try {
    const { type } = req.body || {};
    const Customer = require('../models/Customer');
    const customer = await Customer.findOne({ phone: req.session.customer.phone });
    const plan = customer.plan || 'free';
    
    const planFeatures = {
      free: ['locate', 'alarm', 'stop_alarm', 'lock', 'unlock', 'emergency'],
      plus: ['locate', 'alarm', 'stop_alarm', 'lock', 'unlock', 'emergency', 'geofence', 'alerts'],
      premium: ['locate', 'alarm', 'stop_alarm', 'lock', 'unlock', 'emergency', 'geofence', 'alerts', 'camera', 'audio', 'intruder']
    };
    
    if (!planFeatures[plan] || !planFeatures[plan].includes(type)) {
      req.session.notice = { type: 'error', text: `The '${type}' feature requires an upgrade to a higher plan.` };
      return res.redirect('back');
    }
    let device;
    if (req.session.activeDeviceId) {
      device = await Device.findOne({ phoneNumber: req.session.customer.phone, deviceId: req.session.activeDeviceId });
    }
    if (!device) {
      device = await Device.findOne({ phoneNumber: req.session.customer.phone }).sort({ lastSeen: -1 });
    }
    
    if (!device) {
      req.session.notice = { type: 'error', text: 'No device linked yet. Install the PhoneRakshak app and use the same phone number.' };
      return res.redirect('/customer');
    }
    
    // Create command
    await Command.create({ deviceId: device.deviceId, type, status: 'queued', queuedAt: Date.now() });
    
    const labels = { lock: 'Lock Device', unlock: 'Unlock Device', alarm: 'Play Alarm', stop_alarm: 'Stop Alarm', locate: 'Locate Device', emergency: 'Emergency Mode' };
    
    // Attempt instant delivery via FCM to the app (existing functionality stub)
    // Send Push Notification to Web App Users
    sendAndroidPushAlert(device.deviceId, 'Command Executed', `Your ${labels[type]} command was sent successfully.`, { type: 'command_executed', commandType: type });
    
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
    
    req.session.notice = { type: 'success', text: `Protection mode updated to ${mode.toUpperCase()}.` };
    res.redirect('/customer');
  } catch (err) { next(err); }
};

exports.postSelectDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) return res.redirect('back');
    
    const device = await Device.findOne({ phoneNumber: req.session.customer.phone, deviceId });
    if (device) {
      req.session.activeDeviceId = device.deviceId;
    }
    res.redirect('back');
  } catch (err) { next(err); }
};

exports.postRenameDevice = async (req, res, next) => {
  try {
    const { deviceId, deviceName } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Device ID required' });
    
    let sanitizedName = deviceName ? String(deviceName).trim().substring(0, 30) : '';
    
    const device = await Device.findOne({ phoneNumber: req.session.customer.phone, deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    device.deviceName = sanitizedName;
    await device.save();
    
    req.session.notice = { type: 'success', text: 'Device renamed successfully' };
    res.redirect('back');
  } catch (err) { next(err); }
};

exports.getContacts = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone }).lean();
    const contacts = c.trustedContacts || [];
    const notifications = []; // Mock notifications
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
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
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
    res.render('customer/alerts', { user: req.session.customer, active: 'alerts', ctx, timeAgo });
  } catch (err) { next(err); }
};

exports.getPhotos = async (req, res, next) => {
  try {
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
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

exports.getSupport = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone }).lean();
    let tkt = await SupportTicket.findOne({ phone: c.phone });
    if (!tkt) {
      tkt = await SupportTicket.create({ phone: c.phone });
    }
    const ctx = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
    res.render('customer/support', { 
      user: c || req.session.customer, 
      active: 'support', 
      ctx,
      ticket: tkt
    });
  } catch (err) { next(err); }
};

exports.postSupportChat = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).send('Text required');
    
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    let tkt = await SupportTicket.findOne({ phone: req.session.customer.phone });
    if (!tkt) {
      tkt = await SupportTicket.create({ phone: req.session.customer.phone, status: 'bot_active' });
    }
    
    // Reopen closed or resolved tickets
    if (tkt.status === 'resolved' || tkt.status === 'closed') {
      tkt.status = 'bot_active';
      tkt.issueType = 'unknown';
      tkt.priority = 'normal';
    }

    // Count user messages prior to this one
    const pastUserMsgs = tkt.messages.filter(m => m.sender === 'user').length;
    
    tkt.messages.push({ text, isBot: false, sender: 'user', type: 'text', timestamp: Date.now() });
    
    // Fetch customer context for the AI prompt
    const customerContext = await buildCustomerContext(req.session.customer.phone, req.session.activeDeviceId);
    
    // Check if we need to fall back to static hold message if already human_assigned
    let shouldReply = false;
    let justEscalated = false;
    let botMsg = "";

    if (tkt.status === 'bot_active') {
      shouldReply = true;
      botMsg = await generateSupportResponse(tkt, customerContext);
      
      // Parse for Escalation Keyword
      if (botMsg.includes('[ESCALATE]')) {
        botMsg = botMsg.replace(/\[ESCALATE\]/g, '').trim();
        tkt.status = 'human_assigned';
        tkt.priority = 'urgent';
        justEscalated = true;
      }
      
      // Prevent completely empty messages if regex stripped everything
      if (!botMsg) {
        botMsg = "I am transferring you to a human support agent who can help you further.";
      }
    }
    
    if (tkt.status === 'human_assigned' || tkt.status === 'escalated') {
      const lastMsgIsUser = tkt.messages.length >= 2 && tkt.messages[tkt.messages.length - 2].sender === 'user';
      if (!lastMsgIsUser && !justEscalated) {
        shouldReply = true;
        botMsg = "You are currently in queue. A human support agent will be with you shortly. Thank you for your patience.";
      }
    }
    
    if (shouldReply) {
      tkt.messages.push({ text: botMsg, isBot: true, sender: 'bot', type: 'text', timestamp: Date.now() });
      tkt.botResponseCount = (tkt.botResponseCount || 0) + 1;
      tkt.botHandled = true;
    }
    
    await tkt.save();
    
    // Broadcast via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(tkt._id.toString()).emit('new_message', { ticket: tkt });
    }
    
    res.json({ ticket: tkt });
  } catch (err) { next(err); }
};

exports.postSupportEscalate = async (req, res, next) => {
  try {
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    let tkt = await SupportTicket.findOne({ phone: c.phone });
    if (!tkt) return res.status(404).send('Not found');
    
    tkt.status = 'escalated';
    tkt.priority = c.plan === 'premium' ? 'high' : c.plan === 'plus' ? 'medium' : 'normal';
    await tkt.save();
    
    res.json({ ticket: tkt });
  } catch (err) { next(err); }
};

exports.getSupportHistory = async (req, res, next) => {
  try {
    let tkt = await SupportTicket.findOne({ phone: req.session.customer.phone });
    if (!tkt) {
      tkt = new SupportTicket({ phone: req.session.customer.phone, messages: [] });
    }
    res.json({ ticket: tkt });
  } catch (err) { next(err); }
};

exports.postChangePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const c = await Customer.findOne({ phone: req.session.customer.phone });
    if (!bcrypt.compareSync(currentPassword || '', c.passwordHash)) {
      return res.render('customer/account', { user: req.session.customer, active: 'account', customer: c, error: 'Incorrect current password.', notice: null });
    }
    c.passwordHash = bcrypt.hashSync(newPassword, 10);
    await c.save();
    res.render('customer/account', { user: req.session.customer, active: 'account', customer: c, error: null, notice: 'Password updated successfully.' });
  } catch (err) { next(err); }
};
