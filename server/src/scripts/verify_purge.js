require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Import Models
const Alert = require('../models/Alert');
const AudioRecording = require('../models/AudioRecording');
const BlockedNumber = require('../models/BlockedNumber');
const Command = require('../models/Command');
const Config = require('../models/Config');
const Customer = require('../models/Customer');
const Device = require('../models/Device');
const Intruder = require('../models/Intruder');
const Location = require('../models/Location');
const Report = require('../models/Report');
const SecurityLog = require('../models/SecurityLog');
const SupportTicket = require('../models/SupportTicket');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/phonerakshak');
    
    const stats = {
      Alerts: await Alert.countDocuments(),
      AudioRecordings: await AudioRecording.countDocuments(),
      BlockedNumbers: await BlockedNumber.countDocuments(),
      Commands: await Command.countDocuments(),
      Customers: await Customer.countDocuments(),
      Devices: await Device.countDocuments(),
      Intruders: await Intruder.countDocuments(),
      Locations: await Location.countDocuments(),
      Reports: await Report.countDocuments(),
      SecurityLogs: await SecurityLog.countDocuments(),
      SupportTickets: await SupportTicket.countDocuments(),
      Config: await Config.countDocuments()
    };

    console.log(JSON.stringify(stats, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
