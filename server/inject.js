const db = require('./db');

const device = db.upsertDevice({
  deviceId: 'test-device-123',
  phoneNumber: '+91 98765 43210',
  emergencyNumber: '+91 99999 99999',
  deviceModel: 'samsung SM-A525F',
  city: 'Surat'
});

db.addLocation({
  deviceId: device.deviceId,
  latitude: 21.1702,
  longitude: 72.8311,
  accuracy: 12.5,
  trigger: 'live'
});

db.addAlert({
  deviceId: device.deviceId,
  type: 'sim_change',
  message: 'Jio - 9876543210 -> Airtel - 9123456789',
  meta: {}
});

db.addAlert({
  deviceId: device.deviceId,
  type: 'sim_change',
  message: 'SIM Removed',
  meta: {}
});

db.queueCommand({ deviceId: device.deviceId, type: 'Get Location' });
db.ackCommand(device.deviceId, db.commands[db.commands.length - 1].id, 'Success');

db.queueCommand({ deviceId: device.deviceId, type: 'Lock Device' });
db.ackCommand(device.deviceId, db.commands[db.commands.length - 1].id, 'Success');

db.addIntruderPhoto({ deviceId: device.deviceId, filename: 'mock1.jpg' });
db.addIntruderPhoto({ deviceId: device.deviceId, filename: 'mock2.jpg' });

console.log('Injected live data');
