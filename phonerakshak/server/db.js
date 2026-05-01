const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const INTRUDERS_DIR = path.join(DATA_DIR, 'intruders');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(INTRUDERS_DIR)) fs.mkdirSync(INTRUDERS_DIR, { recursive: true });

const DEFAULT_DB = {
  devices: {},
  locations: [],
  alerts: [],
  commands: [],
  intruders: [],
  wifiSnapshots: [],
  blockedNumbers: [],
  reports: [],
  callsMonitored: 0,
  appVersion: 'v1.3.2',
  adminAuth: null,
  customers: {},
  trustedContacts: [],
  notifications: [],
  batterySamples: [],
  modeChanges: [],
};

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_DB, ...parsed };
  } catch (e) {
    console.error('loadDB failed, resetting:', e.message);
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

let db = loadDB();
let saveTimer = null;

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error('persist failed:', e.message);
    }
  }, 100);
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ----------- Devices -----------
function upsertDevice({ deviceId, phoneNumber, emergencyNumber, deviceModel, city, batteryLevel, appVersion }) {
  if (!deviceId) return null;
  const now = Date.now();
  const existing = db.devices[deviceId] || {};
  const device = {
    deviceId,
    phoneNumber: phoneNumber || existing.phoneNumber || '',
    emergencyNumber: emergencyNumber || existing.emergencyNumber || '',
    deviceModel: deviceModel || existing.deviceModel || '',
    city: city || existing.city || guessCity(phoneNumber || existing.phoneNumber || ''),
    batteryLevel:
      batteryLevel != null ? Math.max(0, Math.min(100, Number(batteryLevel))) : existing.batteryLevel ?? null,
    appVersion: appVersion || existing.appVersion || null,
    registeredAt: existing.registeredAt || now,
    lastSeen: now,
    mode: existing.mode || 'normal',
    modeReason: existing.modeReason || null,
    modeSince: existing.modeSince || now,
  };
  db.devices[deviceId] = device;
  persist();
  return device;
}

function touchDevice(deviceId, extra) {
  if (db.devices[deviceId]) {
    db.devices[deviceId].lastSeen = Date.now();
    if (extra && extra.batteryLevel != null) {
      const level = Math.max(0, Math.min(100, Number(extra.batteryLevel)));
      const prev = db.devices[deviceId].batteryLevel;
      db.devices[deviceId].batteryLevel = level;
      if (prev !== level) addBatterySample(deviceId, level, extra.charging);
    }
    if (extra && extra.appVersion) {
      db.devices[deviceId].appVersion = extra.appVersion;
    }
    persist();
  }
}

function addBatterySample(deviceId, level, charging) {
  if (!deviceId || level == null) return null;
  const entry = {
    id: uid('bat'),
    deviceId,
    level: Math.max(0, Math.min(100, Number(level))),
    charging: !!charging,
    timestamp: Date.now(),
  };
  db.batterySamples.push(entry);
  if (db.batterySamples.length > 5000) db.batterySamples = db.batterySamples.slice(-5000);
  persist();
  return entry;
}

function getBatterySamples(deviceId, limit = 20) {
  return db.batterySamples
    .filter((b) => b.deviceId === deviceId)
    .slice(-limit);
}

function getPrimaryDevice() {
  const list = listDevices();
  return list[0] || null;
}

function getAlertsByType(deviceId, type, limit = 50) {
  return db.alerts
    .filter((a) => a.deviceId === deviceId && a.type === type)
    .slice(-limit)
    .reverse();
}

function listDevices() {
  return Object.values(db.devices).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

function getDevice(deviceId) {
  return db.devices[deviceId] || null;
}

function isOnline(device, windowMs = 5 * 60 * 1000) {
  return device && device.lastSeen && (Date.now() - device.lastSeen) < windowMs;
}

// ----------- Locations -----------
// Network registry: well-known WiFi BSSIDs and cell towers we can resolve
// server-side when the Android client has GPS blocked. In production this would
// be backed by Mozilla Location Service / Google Geolocation API.
const NETWORK_REGISTRY = {
  wifi: {
    'AA:BB:CC:11:22:33': { name: 'CP-Metro-Free-WiFi',   latitude: 28.6328, longitude: 77.2197, accuracy: 60 },
    'AA:BB:CC:11:22:44': { name: 'KhanMarket-Cafe',       latitude: 28.6004, longitude: 77.2275, accuracy: 45 },
    'AA:BB:CC:11:22:55': { name: 'IndiaGate-PublicWiFi',  latitude: 28.6129, longitude: 77.2295, accuracy: 70 },
    'AA:BB:CC:11:22:66': { name: 'CP-Starbucks',          latitude: 28.6315, longitude: 77.2189, accuracy: 35 },
    'AA:BB:CC:11:22:77': { name: 'Janpath-Hotel-WiFi',    latitude: 28.6210, longitude: 77.2190, accuracy: 55 },
  },
  cell: {
    '404-10-1234-5678': { name: 'Airtel CP North',   latitude: 28.6340, longitude: 77.2200, accuracy: 450 },
    '404-10-1234-5679': { name: 'Airtel India Gate', latitude: 28.6135, longitude: 77.2295, accuracy: 520 },
    '405-86-9911-2233': { name: 'Jio Khan Market',   latitude: 28.6005, longitude: 77.2270, accuracy: 380 },
  },
};

function _resolveWifi(aps) {
  if (!Array.isArray(aps) || !aps.length) return null;
  const known = aps
    .map((ap) => ap && NETWORK_REGISTRY.wifi[(ap.bssid || ap.BSSID || '').toUpperCase()])
    .filter(Boolean);
  if (!known.length) return null;
  // Weighted centroid (heavier weight = stronger signal & smaller accuracy)
  let sumW = 0, lat = 0, lng = 0, acc = 0;
  known.forEach((k) => {
    const w = 1 / Math.max(20, k.accuracy);
    sumW += w; lat += k.latitude * w; lng += k.longitude * w; acc += k.accuracy * w;
  });
  return {
    latitude: lat / sumW,
    longitude: lng / sumW,
    accuracy: Math.round(acc / sumW),
    contributors: known.map((k) => k.name),
  };
}

function _resolveCell(towers) {
  if (!Array.isArray(towers) || !towers.length) return null;
  const known = towers
    .map((t) => {
      if (!t) return null;
      const key = [t.mcc, t.mnc, t.lac || t.tac, t.cid].filter((x) => x != null).join('-');
      return NETWORK_REGISTRY.cell[key];
    })
    .filter(Boolean);
  if (!known.length) return null;
  let lat = 0, lng = 0, acc = 0;
  known.forEach((k) => { lat += k.latitude; lng += k.longitude; acc += k.accuracy; });
  return {
    latitude: lat / known.length,
    longitude: lng / known.length,
    accuracy: Math.round(acc / known.length + (known.length === 1 ? 200 : 100)),
    contributors: known.map((k) => k.name),
  };
}

// Public helper: take a raw API payload and return a normalised location +
// chosen source. Preference order: GPS → WiFi → Cell.
function resolveLocationPayload(payload) {
  const { latitude, longitude, accuracy, wifiAps, cellTowers } = payload || {};
  if (latitude != null && longitude != null) {
    return {
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: accuracy != null ? Number(accuracy) : null,
      source: 'gps',
      contributors: [],
    };
  }
  const w = _resolveWifi(wifiAps);
  if (w) return { ...w, source: 'wifi' };
  const c = _resolveCell(cellTowers);
  if (c) return { ...c, source: 'cell' };
  return null;
}

function addLocation({ deviceId, latitude, longitude, accuracy, trigger, source, contributors }) {
  const entry = {
    id: uid('loc'),
    deviceId,
    latitude,
    longitude,
    accuracy: accuracy || null,
    trigger: trigger || 'manual',
    source: source || 'gps',
    contributors: contributors || [],
    timestamp: Date.now(),
  };
  db.locations.push(entry);
  if (db.locations.length > 5000) db.locations = db.locations.slice(-5000);
  touchDevice(deviceId);
  persist();
  evaluateMode(deviceId, 'location');
  return entry;
}

function getLocations(deviceId, limit = 100) {
  return db.locations
    .filter((l) => l.deviceId === deviceId)
    .slice(-limit)
    .reverse();
}

function getLatestLocation(deviceId) {
  for (let i = db.locations.length - 1; i >= 0; i--) {
    if (db.locations[i].deviceId === deviceId) return db.locations[i];
  }
  return null;
}

// ----------- Alerts / Reports -----------
function addAlert({ deviceId, type, message, meta }) {
  const entry = {
    id: uid('alt'),
    deviceId,
    type: type || 'info',
    message: message || '',
    meta: meta || null,
    status: 'pending',
    timestamp: Date.now(),
  };
  db.alerts.push(entry);
  if (db.alerts.length > 5000) db.alerts = db.alerts.slice(-5000);
  // Treat each alert as a "report filed".
  db.reports.push({
    id: uid('rpt'),
    deviceId,
    type: entry.type,
    message: entry.message,
    status: entry.status,
    timestamp: entry.timestamp,
  });
  if (db.reports.length > 5000) db.reports = db.reports.slice(-5000);
  touchDevice(deviceId);
  persist();
  // Re-evaluate protection mode based on the new signal
  if (entry.type !== 'mode_change') evaluateMode(deviceId, 'alert:' + entry.type);
  return entry;
}

function getAlerts(deviceId, limit = 100) {
  return db.alerts
    .filter((a) => a.deviceId === deviceId)
    .slice(-limit)
    .reverse();
}

function getAllAlerts(limit = 200) {
  return db.alerts.slice(-limit).reverse();
}

function setReportStatus(reportId, status) {
  const r = db.reports.find((x) => x.id === reportId);
  if (r) {
    r.status = status;
    persist();
    return true;
  }
  return false;
}

function getRecentReports(limit = 6) {
  return db.reports.slice(-limit).reverse();
}

// ----------- Blocked numbers -----------
function addBlockedNumber(deviceId, number) {
  if (!number) return;
  const existing = db.blockedNumbers.find((b) => b.number === number);
  if (existing) {
    existing.count = (existing.count || 0) + 1;
    existing.lastSeen = Date.now();
  } else {
    db.blockedNumbers.push({
      id: uid('blk'),
      number,
      count: 1,
      addedBy: deviceId || null,
      lastSeen: Date.now(),
      addedAt: Date.now(),
    });
  }
  persist();
}

function getTopBlockedNumbers(limit = 5) {
  return [...db.blockedNumbers]
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, limit);
}

function getAllBlockedNumbers() {
  return [...db.blockedNumbers].sort((a, b) => (b.count || 0) - (a.count || 0));
}

// ----------- Commands -----------
function queueCommand({ deviceId, type, params }) {
  const entry = {
    id: uid('cmd'),
    deviceId,
    type,
    params: params || null,
    status: 'pending',
    queuedAt: Date.now(),
    deliveredAt: null,
    ackedAt: null,
    result: null,
  };
  db.commands.push(entry);
  persist();
  return entry;
}

function getPendingCommands(deviceId) {
  const pending = db.commands.filter(
    (c) => c.deviceId === deviceId && c.status === 'pending'
  );
  pending.forEach((c) => {
    c.status = 'delivered';
    c.deliveredAt = Date.now();
  });
  if (pending.length) persist();
  touchDevice(deviceId);
  return pending;
}

function ackCommand(deviceId, commandId, result) {
  const c = db.commands.find(
    (x) => x.id === commandId && x.deviceId === deviceId
  );
  if (c) {
    c.status = 'done';
    c.ackedAt = Date.now();
    c.result = result || null;
    persist();
    return true;
  }
  return false;
}

function getCommands(deviceId, limit = 50) {
  return db.commands
    .filter((c) => c.deviceId === deviceId)
    .slice(-limit)
    .reverse();
}

// ----------- Intruder photos -----------
function addIntruderPhoto({ deviceId, filename }) {
  const entry = {
    id: uid('intr'),
    deviceId,
    filename,
    timestamp: Date.now(),
  };
  db.intruders.push(entry);
  if (db.intruders.length > 2000) db.intruders = db.intruders.slice(-2000);
  touchDevice(deviceId);
  persist();
  return entry;
}

function getIntruderPhotos(deviceId, limit = 100) {
  return db.intruders
    .filter((i) => i.deviceId === deviceId)
    .slice(-limit)
    .reverse();
}

// ----------- Wi-Fi snapshots -----------
function addWifiSnapshot({ deviceId, ssid, bssid, rssi, linkSpeedMbps, frequencyMhz, capturedAt, trigger }) {
  if (!deviceId) return null;
  const entry = {
    id: uid('wifi'),
    deviceId,
    ssid: ssid || null,
    bssid: bssid || null,
    rssi: rssi != null ? Number(rssi) : null,
    linkSpeedMbps: linkSpeedMbps != null ? Number(linkSpeedMbps) : null,
    frequencyMhz: frequencyMhz != null ? Number(frequencyMhz) : null,
    trigger: trigger || 'manual',
    timestamp: capturedAt ? Number(capturedAt) : Date.now(),
  };
  db.wifiSnapshots.push(entry);
  if (db.wifiSnapshots.length > 2000) {
    db.wifiSnapshots = db.wifiSnapshots.slice(-2000);
  }
  touchDevice(deviceId);
  persist();
  return entry;
}

function getWifiHistory(deviceId, limit = 10) {
  return db.wifiSnapshots
    .filter((w) => w.deviceId === deviceId)
    .slice(-limit)
    .reverse();
}

function getLatestWifi(deviceId) {
  for (let i = db.wifiSnapshots.length - 1; i >= 0; i--) {
    if (db.wifiSnapshots[i].deviceId === deviceId) return db.wifiSnapshots[i];
  }
  return null;
}

// ----------- Stats -----------
function bumpCallsMonitored(n = 1) {
  db.callsMonitored = (db.callsMonitored || 0) + n;
  persist();
}

function getStats() {
  const devices = Object.values(db.devices);
  const total = devices.length;
  const active = devices.filter((d) => isOnline(d)).length;
  const sosAlerts = db.alerts.filter(
    (a) => a.type === 'emergency' || a.type === 'sos'
  ).length;
  const blocked = db.blockedNumbers.reduce(
    (acc, b) => acc + (b.count || 0),
    0
  );
  const reports = db.reports.length;
  return {
    totalUsers: total,
    activeUsers: active,
    sosAlerts,
    blockedNumbers: blocked,
    reportsFiled: reports,
    devicesRegistered: total,
    callsMonitored: db.callsMonitored || 0,
    appVersion: db.appVersion,
  };
}

function getCityBreakdown() {
  const map = new Map();
  Object.values(db.devices).forEach((d) => {
    const c = d.city || 'Others';
    map.set(c, (map.get(c) || 0) + 1);
  });
  const all = [...map.entries()].map(([city, count]) => ({ city, count }));
  all.sort((a, b) => b.count - a.count);
  const top = all.slice(0, 5);
  const others = all.slice(5).reduce((acc, x) => acc + x.count, 0);
  if (others > 0) top.push({ city: 'Others', count: others });
  return top;
}

function getDailySeries(days = 31) {
  const now = new Date();
  const labels = [];
  const userMap = new Map();
  const sosMap = new Map();
  const reportMap = new Map();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(key);
    userMap.set(key, 0);
    sosMap.set(key, 0);
    reportMap.set(key, 0);
  }

  Object.values(db.devices).forEach((d) => {
    const k = new Date(d.registeredAt || d.lastSeen).toISOString().slice(0, 10);
    if (userMap.has(k)) userMap.set(k, userMap.get(k) + 1);
  });
  db.alerts.forEach((a) => {
    const k = new Date(a.timestamp).toISOString().slice(0, 10);
    if (sosMap.has(k) && (a.type === 'emergency' || a.type === 'sos'))
      sosMap.set(k, sosMap.get(k) + 1);
  });
  db.reports.forEach((r) => {
    const k = new Date(r.timestamp).toISOString().slice(0, 10);
    if (reportMap.has(k)) reportMap.set(k, reportMap.get(k) + 1);
  });

  // Cumulative users for the chart line (matches design).
  let cumulative = 0;
  const baseline = Object.values(db.devices).filter((d) => {
    const reg = d.registeredAt || d.lastSeen;
    return reg < new Date(labels[0]).getTime();
  }).length;
  cumulative = baseline;
  const usersSeries = labels.map((k) => {
    cumulative += userMap.get(k);
    return cumulative;
  });

  return {
    labels,
    users: usersSeries,
    sos: labels.map((k) => sosMap.get(k)),
    reports: labels.map((k) => reportMap.get(k)),
  };
}

// ----------- Admin auth -----------
function getAdminAuth() {
  return db.adminAuth || null;
}

function setAdminAuth(auth) {
  db.adminAuth = { ...(db.adminAuth || {}), ...auth, updatedAt: Date.now() };
  persist();
  return db.adminAuth;
}

function clearAdminResetState() {
  if (db.adminAuth) {
    delete db.adminAuth.resetTokenUsedAt;
    delete db.adminAuth.lastResetTokenHash;
    persist();
  }
}

function markResetTokenUsed(tokenHash) {
  db.adminAuth = {
    ...(db.adminAuth || {}),
    lastResetTokenHash: tokenHash,
    resetTokenUsedAt: Date.now(),
  };
  persist();
}

// ----------- Customers (device owners) -----------
function normalizePhone(p) {
  return String(p || '').replace(/[^\d+]/g, '');
}

function getCustomerByPhone(phone) {
  const key = normalizePhone(phone);
  if (!key) return null;
  return db.customers[key] || null;
}

function createCustomer({ phone, name, passwordHash }) {
  const key = normalizePhone(phone);
  if (!key) return null;
  if (db.customers[key]) return null;
  const c = {
    phone: key,
    name: name || '',
    passwordHash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db.customers[key] = c;
  persist();
  return c;
}

function updateCustomer(phone, patch) {
  const key = normalizePhone(phone);
  const c = db.customers[key];
  if (!c) return null;
  Object.assign(c, patch, { updatedAt: Date.now() });
  persist();
  return c;
}

function listCustomerDevices(phone) {
  const key = normalizePhone(phone);
  return Object.values(db.devices)
    .filter((d) => normalizePhone(d.phoneNumber) === key)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

function getCustomerPrimaryDevice(phone) {
  return listCustomerDevices(phone)[0] || null;
}

// ----------- Trusted contacts (emergency notify list) -----------
function listTrustedContacts(ownerPhone) {
  const key = normalizePhone(ownerPhone);
  return db.trustedContacts
    .filter((c) => c.ownerPhone === key)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function getTrustedContact(ownerPhone, contactId) {
  const key = normalizePhone(ownerPhone);
  return db.trustedContacts.find((c) => c.ownerPhone === key && c.id === contactId) || null;
}

function getTrustedContactByToken(token) {
  if (!token) return null;
  return db.trustedContacts.find((c) => c.token === token) || null;
}

function addTrustedContact({ ownerPhone, name, phone, email }) {
  const key = normalizePhone(ownerPhone);
  if (!key) return null;
  const contactPhone = normalizePhone(phone);
  if (!contactPhone || contactPhone.replace(/\D/g, '').length < 7) return null;
  const existing = db.trustedContacts.find(
    (c) => c.ownerPhone === key && c.phone === contactPhone
  );
  if (existing) return existing;
  const entry = {
    id: uid('tc'),
    ownerPhone: key,
    name: (name || '').trim() || 'Trusted contact',
    phone: contactPhone,
    email: (email || '').trim() || null,
    token: require('crypto').randomBytes(18).toString('base64url'),
    createdAt: Date.now(),
    lastNotifiedAt: null,
  };
  db.trustedContacts.push(entry);
  persist();
  return entry;
}

function deleteTrustedContact(ownerPhone, contactId) {
  const key = normalizePhone(ownerPhone);
  const before = db.trustedContacts.length;
  db.trustedContacts = db.trustedContacts.filter(
    (c) => !(c.ownerPhone === key && c.id === contactId)
  );
  if (db.trustedContacts.length !== before) {
    db.notifications = db.notifications.filter((n) => n.contactId !== contactId);
    persist();
    return true;
  }
  return false;
}

function notifyTrustedContacts(ownerPhone, type, payload) {
  const key = normalizePhone(ownerPhone);
  const contacts = listTrustedContacts(key);
  if (!contacts.length) return [];
  const now = Date.now();
  const created = contacts.map((c) => {
    c.lastNotifiedAt = now;
    const entry = {
      id: uid('ntf'),
      contactId: c.id,
      ownerPhone: key,
      type,
      payload: payload || null,
      createdAt: now,
      viewedAt: null,
    };
    db.notifications.push(entry);
    return entry;
  });
  if (db.notifications.length > 5000) db.notifications = db.notifications.slice(-5000);
  persist();
  return created;
}

function listNotificationsFor(ownerPhone, limit = 50) {
  const key = normalizePhone(ownerPhone);
  return db.notifications
    .filter((n) => n.ownerPhone === key)
    .slice(-limit)
    .reverse();
}

function listNotificationsForContact(contactId, limit = 50) {
  return db.notifications
    .filter((n) => n.contactId === contactId)
    .slice(-limit)
    .reverse();
}

// ----------- Family-circle live status -----------
function _haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ----------- Auto Mode switching -----------
// Three protection modes:
//   normal     → low battery usage (default, ~60 s ping)
//   suspicious → more tracking after a soft trigger (~30 s ping)
//   theft      → aggressive tracking + alerts (~10 s ping, auto-locate, contacts notified)
const MODE_RANK = { normal: 0, suspicious: 1, theft: 2 };
const MODE_PING_SEC = { normal: 60, suspicious: 30, theft: 10 };

function _setMode(device, mode, reason, source) {
  if (!device || !MODE_RANK.hasOwnProperty(mode)) return false;
  if (device.mode === mode) return false;
  const from = device.mode || 'normal';
  device.mode = mode;
  device.modeReason = reason || null;
  device.modeSince = Date.now();
  db.modeChanges.push({
    id: uid('mch'),
    deviceId: device.deviceId,
    from,
    to: mode,
    reason: reason || null,
    source: source || 'auto',
    timestamp: device.modeSince,
  });
  if (db.modeChanges.length > 2000) db.modeChanges = db.modeChanges.slice(-2000);
  // When escalating, automatically queue a fresh locate command and add a
  // synthetic alert so the change shows up in dashboards + activity feeds.
  if (MODE_RANK[mode] > MODE_RANK[from]) {
    db.commands.push({
      id: uid('cmd'),
      deviceId: device.deviceId,
      type: 'locate',
      status: 'pending',
      issuedAt: Date.now(),
      meta: { auto: true, reason: 'mode-escalation:' + mode },
    });
    db.alerts.push({
      id: uid('alt'),
      deviceId: device.deviceId,
      type: 'mode_change',
      message: `Mode escalated to ${mode.toUpperCase()}`,
      meta: { from, to: mode, reason, source: source || 'auto' },
      status: 'new',
      timestamp: Date.now(),
    });
  } else {
    db.alerts.push({
      id: uid('alt'),
      deviceId: device.deviceId,
      type: 'mode_change',
      message: `Mode set to ${mode.toUpperCase()}`,
      meta: { from, to: mode, reason, source: source || 'auto' },
      status: 'new',
      timestamp: Date.now(),
    });
  }
  return true;
}

function setModeManual(deviceId, mode, reason, source) {
  const device = db.devices[deviceId];
  if (!device) return null;
  const changed = _setMode(device, mode, reason, source || 'manual');
  if (changed) persist();
  return device;
}

function evaluateMode(deviceId, trigger) {
  const device = db.devices[deviceId];
  if (!device) return null;
  // Once in theft, only manual override can downgrade — return early.
  if (device.mode === 'theft') return device;

  const now = Date.now();
  const recentAlerts = db.alerts.filter(
    (a) => a.deviceId === deviceId && a.timestamp > now - 30 * 60 * 1000
  );
  let target = device.mode;
  let reason = device.modeReason;

  // ---- Theft triggers (highest priority) ----
  const theftAlerts = recentAlerts.filter((a) =>
    ['sim_change', 'intruder_photo', 'emergency', 'sos'].includes(a.type)
  );
  const wrongPinCount = recentAlerts.filter((a) => a.type === 'wrong_pin').length;
  if (theftAlerts.length > 0) {
    target = 'theft';
    reason = theftAlerts[theftAlerts.length - 1].message ||
      'Theft signal detected (' + theftAlerts[theftAlerts.length - 1].type + ')';
  } else if (wrongPinCount >= 3) {
    target = 'theft';
    reason = `${wrongPinCount} wrong PIN attempts in 30 min`;
  } else {
    // ---- Suspicious triggers ----
    const airplane = recentAlerts.find((a) => a.type === 'airplane_mode');
    if (airplane) {
      target = 'suspicious';
      reason = 'Airplane mode turned on';
    }
    // Unusual movement: >500 m in <2 min (last two locations)
    const locs = getLocations(deviceId, 2);
    if (locs.length === 2) {
      const dt = (locs[0].timestamp - locs[1].timestamp) / 60000;
      const dM = _haversineMeters(locs[0], locs[1]);
      if (dt > 0 && dt < 2 && dM > 500) {
        if (target !== 'theft') {
          target = 'suspicious';
          reason = `Rapid movement: ${Math.round(dM)} m in ${dt.toFixed(1)} min`;
        }
      }
    }
  }

  if (target !== device.mode) {
    _setMode(device, target, reason, trigger || 'auto');
    persist();
  }
  return device;
}

function getModeHistory(deviceId, limit = 20) {
  return db.modeChanges
    .filter((m) => m.deviceId === deviceId)
    .slice(-limit)
    .reverse();
}

function getModeInfo(device) {
  if (!device) return null;
  const mode = device.mode || 'normal';
  return {
    mode,
    reason: device.modeReason || null,
    since: device.modeSince || null,
    pingIntervalSec: MODE_PING_SEC[mode],
    aggressive: mode === 'theft',
  };
}

function computeLiveStatus(ownerPhone) {
  const device = getCustomerPrimaryDevice(ownerPhone);
  if (!device) {
    return { ok: false, reason: 'no-device' };
  }

  const locs = getLocations(device.deviceId, 6); // newest first
  const latest = locs[0] || null;
  const previous = locs[1] || null;
  const tenMinAgo = Date.now() - 10 * 60 * 1000;

  // Motion: compare two most recent locations
  let motion = { state: 'unknown', distanceM: 0, sinceMin: null };
  if (latest && previous) {
    const d = _haversineMeters(latest, previous);
    const dtMin = Math.max(1, (latest.timestamp - previous.timestamp) / 60000);
    if (latest.timestamp >= tenMinAgo) {
      motion = {
        state: d > 50 ? 'moving' : 'stationary',
        distanceM: Math.round(d),
        sinceMin: Math.round(dtMin),
      };
    } else {
      motion = { state: 'idle', distanceM: Math.round(d), sinceMin: Math.round(dtMin) };
    }
  } else if (latest) {
    motion = { state: 'stationary', distanceM: 0, sinceMin: null };
  }

  // Battery trend
  const samples = getBatterySamples(device.deviceId, 8);
  let trend = 'stable';
  let chargingNow = false;
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    chargingNow = !!last.charging;
    if (chargingNow) trend = 'charging';
    else if (last.level > first.level + 1) trend = 'charging';
    else if (last.level < first.level - 1) trend = 'discharging';
    else trend = 'stable';
  } else if (samples.length === 1) {
    chargingNow = !!samples[0].charging;
    trend = chargingNow ? 'charging' : 'stable';
  }
  const battery = {
    level: device.batteryLevel,
    trend,
    charging: chargingNow,
  };

  // Synthesize unified activity feed (newest first)
  const events = [];
  locs.forEach((l, i) => {
    const srcLabel = (l.source || 'gps').toUpperCase();
    if (i === 0) {
      events.push({
        ts: l.timestamp,
        kind: 'location',
        title: `Phone reported location · ${srcLabel}`,
        detail: l.accuracy
          ? `Accuracy ±${Math.round(l.accuracy)} m${l.contributors && l.contributors.length ? ' · via ' + l.contributors.join(', ') : ''}`
          : '',
      });
    } else {
      const next = locs[i - 1]; // newer
      const d = Math.round(_haversineMeters(l, next));
      if (d >= 30) {
        events.push({
          ts: next.timestamp,
          kind: d > 200 ? 'move-far' : 'move-near',
          title: d > 200 ? `Phone moved ${d} m` : `Small movement (${d} m)`,
          detail: `via ${(next.source || 'gps').toUpperCase()}`,
        });
      }
    }
  });
  samples
    .slice()
    .reverse()
    .forEach((s, idx, arr) => {
      const next = arr[idx - 1];
      if (!next) {
        events.push({
          ts: s.timestamp,
          kind: s.charging ? 'battery-charging' : 'battery',
          title: s.charging ? `Charging (${s.level}%)` : `Battery at ${s.level}%`,
          detail: '',
        });
      } else if (next.charging !== s.charging) {
        events.push({
          ts: s.timestamp,
          kind: s.charging ? 'battery-charging' : 'battery-unplugged',
          title: s.charging ? 'Plugged into charger' : 'Unplugged from charger',
          detail: `Battery at ${s.level}%`,
        });
      } else if (Math.abs(s.level - next.level) >= 3) {
        events.push({
          ts: s.timestamp,
          kind: s.level > next.level ? 'battery-charging' : 'battery',
          title: s.level > next.level
            ? `Battery up to ${s.level}%`
            : `Battery dropped to ${s.level}%`,
          detail: '',
        });
      }
    });
  getAlerts(device.deviceId, 8).forEach((a) => {
    events.push({
      ts: a.timestamp,
      kind: 'alert-' + a.type,
      title:
        a.type === 'sim_change' ? 'SIM card changed' :
        a.type === 'wrong_pin' ? 'Wrong PIN attempt' :
        a.type === 'intruder_photo' ? 'Intruder photo captured' :
        a.type === 'emergency' ? 'Emergency Mode triggered' :
        a.type === 'sos' ? 'SOS triggered' :
        a.type === 'airplane_mode' ? 'Airplane mode turned on' :
        a.type === 'mode_change' ? a.message :
        (a.message || a.type),
      detail: a.type === 'mode_change' && a.meta && a.meta.reason ? a.meta.reason : '',
    });
  });
  events.sort((a, b) => b.ts - a.ts);

  const photos = getIntruderPhotos(device.deviceId, 1);

  const modeInfo = getModeInfo(device);
  return {
    ok: true,
    nowTs: Date.now(),
    device: {
      model: device.deviceModel,
      lastSeen: device.lastSeen,
      online: isOnline(device),
    },
    protection: modeInfo,
    location: latest
      ? {
          latitude: latest.latitude,
          longitude: latest.longitude,
          timestamp: latest.timestamp,
          accuracy: latest.accuracy,
          source: latest.source || 'gps',
          contributors: latest.contributors || [],
        }
      : null,
    motion,
    battery,
    events: events.slice(0, 12),
    latestPhoto: photos[0] ? { filename: photos[0].filename, timestamp: photos[0].timestamp } : null,
  };
}

function markNotificationsViewed(contactId) {
  const now = Date.now();
  let changed = false;
  db.notifications.forEach((n) => {
    if (n.contactId === contactId && !n.viewedAt) {
      n.viewedAt = now;
      changed = true;
    }
  });
  if (changed) persist();
}

function ensureDemoCustomer({ phone, name, passwordHash, deviceModel }) {
  const key = normalizePhone(phone);
  let c = db.customers[key];
  if (!c) {
    c = createCustomer({ phone, name, passwordHash });
  }
  let device = listCustomerDevices(phone)[0];
  if (!device) {
    device = upsertDevice({
      deviceId: 'demo_device_' + key.slice(-6),
      phoneNumber: key,
      emergencyNumber: '+919811000111',
      deviceModel: deviceModel || 'Pixel 7',
      city: 'Delhi',
      batteryLevel: 78,
      appVersion: db.appVersion,
    });
  }
  // Seed sample data only if device has none
  const existingLocs = getLocations(device.deviceId, 1);
  if (existingLocs.length === 0) {
    // A short walk from Connaught Place toward India Gate over the last ~15 min,
    // demonstrating a mix of location sources (GPS → WiFi → Cell fallback)
    const trail = [
      { lat: 28.6328, lng: 77.2197, t: 15, acc: 12,  src: 'gps',  contrib: [] },
      { lat: 28.6298, lng: 77.2210, t: 11, acc: 14,  src: 'gps',  contrib: [] },
      { lat: 28.6253, lng: 77.2225, t: 7,  acc: 35,  src: 'wifi', contrib: ['CP-Starbucks'] },
      { lat: 28.6201, lng: 77.2245, t: 3,  acc: 18,  src: 'gps',  contrib: [] },
      { lat: 28.6135, lng: 77.2295, t: 0,  acc: 520, src: 'cell', contrib: ['Airtel India Gate'] },
    ];
    trail.forEach((p) => {
      addLocation({
        deviceId: device.deviceId,
        latitude: p.lat,
        longitude: p.lng,
        accuracy: p.acc,
        trigger: 'auto',
        source: p.src,
        contributors: p.contrib,
      });
      const last = db.locations[db.locations.length - 1];
      last.timestamp = Date.now() - p.t * 60 * 1000;
    });
    // Battery dropping then a charging event
    [
      { l: 86, c: false, t: 30 }, { l: 84, c: false, t: 24 }, { l: 81, c: false, t: 18 },
      { l: 78, c: false, t: 12 }, { l: 76, c: true, t: 4 }, { l: 78, c: true, t: 0 },
    ].forEach((s) => {
      const e = addBatterySample(device.deviceId, s.l, s.c);
      if (e) e.timestamp = Date.now() - s.t * 60 * 1000;
    });
    addAlert({ deviceId: device.deviceId, type: 'sim_change', message: 'SIM card changed',
      meta: { oldSim: '8991 1010 0000 1234', newSim: '8991 1010 0000 9876' } });
    addAlert({ deviceId: device.deviceId, type: 'wrong_pin', message: 'Wrong PIN attempt' });
    addAlert({ deviceId: device.deviceId, type: 'intruder_photo', message: 'Intruder photo captured' });
    queueCommand({ deviceId: device.deviceId, type: 'lock' });
    queueCommand({ deviceId: device.deviceId, type: 'locate' });
    persist();
  }
  // Seed one trusted contact + a sample emergency notification
  if (listTrustedContacts(c.phone).length === 0) {
    const tc = addTrustedContact({
      ownerPhone: c.phone,
      name: 'Priya Sharma (Mom)',
      phone: '+919811000333',
      email: 'priya@example.com',
    });
    if (tc) {
      const latest = getLatestLocation(device.deviceId);
      notifyTrustedContacts(c.phone, 'emergency', {
        deviceModel: device.deviceModel,
        ownerName: c.name,
        latitude: latest && latest.latitude,
        longitude: latest && latest.longitude,
      });
    }
  }
  return { customer: c, device };
}

function guessCity(phone) {
  if (!phone) return 'Others';
  const cities = ['Delhi', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Pune'];
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = (h * 31 + phone.charCodeAt(i)) | 0;
  return cities[Math.abs(h) % cities.length];
}

module.exports = {
  INTRUDERS_DIR,
  getAdminAuth,
  setAdminAuth,
  clearAdminResetState,
  markResetTokenUsed,
  getPrimaryDevice,
  getAlertsByType,
  upsertDevice,
  touchDevice,
  listDevices,
  getDevice,
  isOnline,
  addLocation,
  getLocations,
  getLatestLocation,
  addAlert,
  getAlerts,
  getAllAlerts,
  getRecentReports,
  setReportStatus,
  addBlockedNumber,
  getTopBlockedNumbers,
  getAllBlockedNumbers,
  queueCommand,
  getPendingCommands,
  ackCommand,
  getCommands,
  addIntruderPhoto,
  getIntruderPhotos,
  addWifiSnapshot,
  getWifiHistory,
  getLatestWifi,
  bumpCallsMonitored,
  getStats,
  getCityBreakdown,
  getDailySeries,
  normalizePhone,
  getCustomerByPhone,
  createCustomer,
  updateCustomer,
  listCustomerDevices,
  getCustomerPrimaryDevice,
  ensureDemoCustomer,
  listTrustedContacts,
  getTrustedContact,
  getTrustedContactByToken,
  addTrustedContact,
  deleteTrustedContact,
  notifyTrustedContacts,
  listNotificationsFor,
  listNotificationsForContact,
  markNotificationsViewed,
  addBatterySample,
  getBatterySamples,
  computeLiveStatus,
  resolveLocationPayload,
  NETWORK_REGISTRY,
  evaluateMode,
  setModeManual,
  getModeHistory,
  getModeInfo,
  MODE_PING_SEC,
};
