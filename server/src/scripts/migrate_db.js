require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const Device = require('../models/Device');
const Location = require('../models/Location');
const Alert = require('../models/Alert');
const Command = require('../models/Command');
const Intruder = require('../models/Intruder');
const BlockedNumber = require('../models/BlockedNumber');
const Report = require('../models/Report');

const DB_FILE = path.join(__dirname, '../../data/db.json');

const migrate = async () => {
  await connectDB();
  
  if (!fs.existsSync(DB_FILE)) {
    console.log('No db.json found. Skipping migration.');
    process.exit(0);
  }

  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const oldDb = JSON.parse(raw);

  console.log('Starting migration from db.json to MongoDB...');

  try {
    // 1. Devices
    if (oldDb.devices) {
      const devices = Object.values(oldDb.devices);
      for (const d of devices) {
        await Device.findOneAndUpdate(
          { deviceId: d.deviceId },
          { ...d },
          { upsert: true }
        );
      }
      console.log(`Migrated ${devices.length} devices.`);
    }

    // 2. Locations
    if (oldDb.locations && oldDb.locations.length > 0) {
      await Location.deleteMany({});
      await Location.insertMany(oldDb.locations);
      console.log(`Migrated ${oldDb.locations.length} locations.`);
    }

    // 3. Alerts
    if (oldDb.alerts && oldDb.alerts.length > 0) {
      await Alert.deleteMany({});
      await Alert.insertMany(oldDb.alerts);
      console.log(`Migrated ${oldDb.alerts.length} alerts.`);
    }

    // 4. Commands
    if (oldDb.commands && oldDb.commands.length > 0) {
      await Command.deleteMany({});
      await Command.insertMany(oldDb.commands);
      console.log(`Migrated ${oldDb.commands.length} commands.`);
    }

    // 5. Intruders
    if (oldDb.intruders && oldDb.intruders.length > 0) {
      await Intruder.deleteMany({});
      await Intruder.insertMany(oldDb.intruders);
      console.log(`Migrated ${oldDb.intruders.length} intruder photos.`);
    }

    // 6. Blocked Numbers
    if (oldDb.blockedNumbers && oldDb.blockedNumbers.length > 0) {
      await BlockedNumber.deleteMany({});
      await BlockedNumber.insertMany(oldDb.blockedNumbers);
      console.log(`Migrated ${oldDb.blockedNumbers.length} blocked numbers.`);
    }

    // 7. Reports
    if (oldDb.reports && oldDb.reports.length > 0) {
      await Report.deleteMany({});
      await Report.insertMany(oldDb.reports);
      console.log(`Migrated ${oldDb.reports.length} reports.`);
    }

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrate();
