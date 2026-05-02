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
  blockedNumbers: [],
  reports: [],
  securityLogs: [],
  callsMonitored: 0,
  appVersion: 'v1.3.2',
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
function upsertDevice({ deviceId, phoneNumber, emergencyNumber, deviceModel, city }) {
  if (!deviceId) return null;
  const now = Date.now();
  const existing = db.devices[deviceId] || {};
  const device = {
    deviceId,
    phoneNumber: phoneNumber || existing.phoneNumber || '',
    emergencyNumber: emergencyNumber || existing.emergencyNumber || '',
    deviceModel: deviceModel || existing.deviceModel || '',
    city: city || existing.city || guessCity(phoneNumber || existing.phoneNumber || ''),
    registeredAt: existing.registeredAt || now,
    lastSeen: now,
  };
  db.devices[deviceId] = device;
  persist();
  return device;
}

function touchDevice(deviceId) {
  if (db.devices[deviceId]) {
    db.devices[deviceId].lastSeen = Date.now();
    persist();
  }
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
function addLocation({ deviceId, latitude, longitude, accuracy, trigger }) {
  const entry = {
    id: uid('loc'),
    deviceId,
    latitude,
    longitude,
    accuracy: accuracy || null,
    trigger: trigger || 'manual',
    timestamp: Date.now(),
  };
  db.locations.push(entry);
  if (db.locations.length > 5000) db.locations = db.locations.slice(-5000);
  touchDevice(deviceId);
  persist();
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

function guessCity(phone) {
  if (!phone) return 'Others';
  const cities = ['Delhi', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Pune'];
  let h = 0;
  for (let i = 0; i < phone.length; i++) h = (h * 31 + phone.charCodeAt(i)) | 0;
  return cities[Math.abs(h) % cities.length];
}

// ----------- Security Logs -----------
function addSecurityLog({ ip, type, message }) {
  const entry = {
    id: uid('sec'),
    ip: ip || 'Unknown',
    type: type || 'threat',
    message: message || '',
    timestamp: Date.now(),
  };
  db.securityLogs = db.securityLogs || [];
  db.securityLogs.push(entry);
  if (db.securityLogs.length > 2000) db.securityLogs = db.securityLogs.slice(-2000);
  persist();
  return entry;
}

function getSecurityLogs(limit = 100) {
  return [...(db.securityLogs || [])].slice(-limit).reverse();
}

module.exports = {
  INTRUDERS_DIR,
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
  bumpCallsMonitored,
  getStats,
  getCityBreakdown,
  getDailySeries,
  addSecurityLog,
  getSecurityLogs,
};
