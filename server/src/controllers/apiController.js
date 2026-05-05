const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const BlockedNumber = require('../models/BlockedNumber');
const Report = require('../models/Report');
const AudioRecording = require('../models/AudioRecording');
const logger = require('../utils/logger');
const { generateToken } = require('../middlewares/auth');
const { sendAndroidPushAlert, admin } = require('../utils/firebase');
const Customer = require('../models/Customer');

exports.firebaseLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });

    // Verify token with Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid: firebaseUid, phone_number: phone } = decodedToken;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number not found in Firebase token' });
    }

    // Lookup or Create Customer
    let customer = await Customer.findOne({ $or: [{ firebaseUid }, { phone }] });
    if (!customer) {
      customer = await Customer.create({
        phone,
        firebaseUid,
        plan: 'free',
        deviceLimit: 1
      });
      logger.info(`New customer created via Firebase Login: ${phone}`);
    } else {
      // Update firebaseUid if missing (legacy linking)
      if (!customer.firebaseUid) {
        customer.firebaseUid = firebaseUid;
        await customer.save();
      }
    }

    const token = generateToken(customer._id);
    res.json({ success: true, token, user: { _id: customer._id, phone: customer.phone, plan: customer.plan } });
  } catch (err) {
    logger.error(`Firebase Login Error: ${err.message}`);
    res.status(401).json({ error: 'Invalid Firebase Token' });
  }
};

exports.upsertDevice = async (req, res, next) => {
  try {
    const { deviceId, deviceModel, fcmToken } = req.body || {};
    const userId = req.userId;
    
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    if (!userId) return res.status(401).json({ error: 'Unauthorized: userId missing from token' });
    
    let device = await Device.findOne({ deviceId });
    if (device) {
      device.userId = userId;
      device.deviceModel = deviceModel || device.deviceModel;
      if (fcmToken) device.fcmToken = fcmToken;
      device.lastSeen = Date.now();
      await device.save();
    } else {
      device = await Device.create({ deviceId, userId, deviceModel, fcmToken, registeredAt: Date.now(), lastSeen: Date.now() });
    }
    
    const io = req.app.get('io');
    if (io) io.emit('device_updated', device);
    
    res.json({ ok: true, device });
  } catch (err) { next(err); }
};

exports.registerFcm = async (req, res, next) => {
  try {
    const { deviceId, fcmToken } = req.body;
    if (!deviceId || !fcmToken) {
      return res.status(400).json({ error: 'deviceId and fcmToken are required' });
    }
    
    // We update the token for the device
    const device = await Device.findOneAndUpdate(
      { deviceId },
      { fcmToken, lastSeen: Date.now() },
      { new: true }
    );
    
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({ ok: true, message: 'FCM Token registered successfully' });
  } catch (err) { next(err); }
};

exports.pingDevice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const device = await Device.findOneAndUpdate({ deviceId: id }, { lastSeen: Date.now() }, { new: true });
    res.json({ ok: true, trackingMode: device ? device.trackingMode : 0 });
  } catch (err) { next(err); }
};

exports.addLocation = async (req, res, next) => {
  try {
    const { deviceId, latitude, longitude, accuracy, trigger } = req.body || {};
    if (!deviceId || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'deviceId, latitude, longitude required' });
    }
    const entry = await Location.create({
      deviceId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy != null ? Number(accuracy) : null,
      trigger
    });
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_location', entry);
      io.emit('device_updated', device);
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.addAlert = async (req, res, next) => {
  try {
    const { deviceId, type, message, meta } = req.body || {};
    if (!deviceId || !type) return res.status(400).json({ error: 'deviceId and type required' });
    
    const entry = await Alert.create({ deviceId, type, message, meta });
    await Report.create({ deviceId, type, message, status: 'pending', timestamp: entry.timestamp });
    
    const blocked = (meta && (meta.blockedNumber || meta.number)) || (type === 'blocked_call' && message);
    if (blocked) {
      let bNumber = await BlockedNumber.findOne({ number: String(blocked) });
      if (bNumber) {
        bNumber.count += 1;
        bNumber.lastSeen = Date.now();
        await bNumber.save();
      } else {
        await BlockedNumber.create({ number: String(blocked), count: 1, addedBy: deviceId, lastSeen: Date.now() });
      }
    }
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_alert', entry);
      io.emit('device_updated', device);
    }
    
    // Send Push Notification
    if (deviceId) {
      sendAndroidPushAlert(deviceId, 'PhoneRakshak Alert', message, { type });
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.getCommands = async (req, res, next) => {
  try {
    const fifteenSecsAgo = new Date(Date.now() - 15000);
    const pending = await Command.find({ 
      deviceId: req.params.id, 
      $or: [
        { status: 'queued' },
        { status: 'processing', processingAt: { $lt: fifteenSecsAgo } }
      ]
    });
    
    if (pending.length > 0) {
      await Command.updateMany(
        { _id: { $in: pending.map(c => c._id) } },
        { status: 'processing', processingAt: Date.now() }
      );
      await Device.findOneAndUpdate({ deviceId: req.params.id }, { lastSeen: Date.now() });
    }
    
    // Convert to what Android expects or just send
    // Since Android might still expect 'pending' -> 'delivered', wait,
    // we should just return the documents. The Android app checks if response is successful.
    res.json({ commands: pending });
  } catch (err) { next(err); }
};

exports.ackCommand = async (req, res, next) => {
  try {
    const { id, cid } = req.params;
    const { result } = req.body;
    
    // Find by the command _id or by the custom id field if passed as cid
    const command = await Command.findOne({ _id: cid, deviceId: id }).catch(() => Command.findOne({ id: cid, deviceId: id }));
    
    if (command) {
      command.status = 'executed';
      command.ackedAt = Date.now();
      command.result = result;
      await command.save();
      
      const io = req.app.get('io');
      if (io) io.emit('command_status_change', command);
      
      res.json({ ok: true });
    } else {
      res.json({ ok: false });
    }
  } catch (err) { next(err); }
};

exports.addIntruder = async (req, res, next) => {
  try {
    const deviceId = req.body.deviceId || (req.file && req.file.filename) ? req.body.deviceId : null;
    if (!deviceId || !req.file) return res.status(400).json({ error: 'deviceId and photo required' });
    
    let fileUrl = req.file.filename;
    const { admin } = require('../utils/firebase');
    
    if (admin.apps.length > 0 && process.env.FIREBASE_STORAGE_BUCKET) {
      try {
        const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
        const destination = `intruders/${req.file.filename}`;
        const crypto = require('crypto');
        const token = crypto.randomUUID();
        
        await bucket.upload(req.file.path, {
          destination: destination,
          metadata: {
            contentType: req.file.mimetype,
            metadata: { firebaseStorageDownloadTokens: token }
          }
        });
        
        fileUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(destination)}?alt=media&token=${token}`;
        
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (uploadErr) {
        console.error('Firebase upload failed:', uploadErr);
      }
    }

    const entry = await Intruder.create({ deviceId, filename: fileUrl });
    const alertEntry = await Alert.create({
      deviceId,
      type: 'intruder_photo',
      message: 'Intruder photo captured',
      meta: { filename: fileUrl }
    });
    await Report.create({ deviceId, type: 'intruder_photo', message: 'Intruder photo captured' });
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_intruder', entry);
      io.emit('new_alert', alertEntry);
      io.emit('device_updated', device);
    }
    
    // Send Push Notification
    if (deviceId) {
      sendAndroidPushAlert(deviceId, 'Intruder Detected!', 'An intruder photo was captured on your device.', { type: 'intruder_photo' });
    }

    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.addAudio = async (req, res, next) => {
  try {
    const deviceId = req.body.deviceId || (req.file && req.file.filename) ? req.body.deviceId : null;
    if (!deviceId || !req.file) return res.status(400).json({ error: 'deviceId and audio required' });
    
    let fileUrl = req.file.filename;
    const { admin } = require('../utils/firebase');
    
    if (admin.apps.length > 0 && process.env.FIREBASE_STORAGE_BUCKET) {
      try {
        const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
        const destination = `audio/${req.file.filename}`;
        const crypto = require('crypto');
        const token = crypto.randomUUID();
        
        await bucket.upload(req.file.path, {
          destination: destination,
          metadata: {
            contentType: req.file.mimetype,
            metadata: { firebaseStorageDownloadTokens: token }
          }
        });
        
        fileUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(destination)}?alt=media&token=${token}`;
        
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (uploadErr) {
        console.error('Firebase upload failed:', uploadErr);
      }
    }

    const entry = await AudioRecording.create({ deviceId, filename: fileUrl });
    const alertEntry = await Alert.create({
      deviceId,
      type: 'audio_surveillance',
      message: 'Ambient audio recorded',
      meta: { filename: fileUrl }
    });
    const device = await Device.findOneAndUpdate({ deviceId }, { lastSeen: Date.now() }, { new: true });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('new_audio', entry);
      io.emit('new_alert', alertEntry);
      io.emit('device_updated', device);
    }

    // Send Push Notification
    if (deviceId) {
      sendAndroidPushAlert(deviceId, 'Audio Recorded', 'Ambient audio was recorded on your device.', { type: 'audio_surveillance' });
    }
    
    res.json({ ok: true, entry });
  } catch (err) { next(err); }
};

exports.registerFace = async (req, res, next) => {
  try {
    const { deviceId, faceDescriptor } = req.body;
    if (!deviceId || !faceDescriptor || !Array.isArray(faceDescriptor)) {
      return res.status(400).json({ error: 'deviceId and faceDescriptor array required' });
    }
    
    // Generate a simple 6 digit recovery code
    const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const device = await Device.findOneAndUpdate(
      { deviceId }, 
      { faceDescriptor, recoveryCode },
      { new: true }
    );
    
    if (!device) return res.status(404).json({ error: 'Device not found' });
    
    res.json({ ok: true, recoveryCode });
  } catch (err) { next(err); }
};

exports.verifyFace = async (req, res, next) => {
  try {
    const { recoveryCode, liveDescriptor } = req.body;
    if (!recoveryCode || !liveDescriptor || !Array.isArray(liveDescriptor)) {
      return res.status(400).json({ error: 'recoveryCode and liveDescriptor array required' });
    }
    
    const device = await Device.findOne({ recoveryCode });
    if (!device) return res.status(404).json({ error: 'Invalid recovery code' });
    
    if (!device.faceDescriptor || device.faceDescriptor.length === 0) {
      return res.status(400).json({ error: 'No face descriptor registered for this account' });
    }
    
    // Calculate Euclidean distance
    let distance = 0;
    for (let i = 0; i < device.faceDescriptor.length; i++) {
      distance += Math.pow(device.faceDescriptor[i] - (liveDescriptor[i] || 0), 2);
    }
    distance = Math.sqrt(distance);
    
    // Threshold for matching
    const THRESHOLD = 1.0; 
    
    if (distance < THRESHOLD) {
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'phonerakshak_super_secret_key_123!';
      const token = jwt.sign({ deviceId: device.deviceId, role: 'recovery' }, JWT_SECRET, { expiresIn: '1h' });
      
      res.json({ ok: true, token, deviceId: device.deviceId });
    } else {
      res.status(401).json({ error: 'Face verification failed' });
    }
  } catch (err) { next(err); }
};

exports.getGeofence = async (req, res, next) => {
  try {
    const device = await Device.findOne({ deviceId: req.params.id });
    if (!device) return res.status(404).send('Device not found');
    res.json(device.geofence || { enabled: false });
  } catch (err) { next(err); }
};
const SupportTicket = require('../models/SupportTicket');
const { generateSupportResponse } = require('../utils/gemini');

exports.postSupportChat = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).send('Text required');
    
    const c = await Customer.findOne({ phone: c.phone });
    let tkt = await SupportTicket.findOne({ phone: c.phone });
    if (!tkt) {
      tkt = await SupportTicket.create({ phone: c.phone, status: 'bot_active' });
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
    const customerContext = await buildCustomerContext(c.phone, req.deviceId);
    
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

