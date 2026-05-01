require('dotenv').config();
const mongoose = require('mongoose');
const Device = require('./src/models/Device');
const Command = require('./src/models/Command');

const MOCK_MONGO_URI = 'mongodb+srv://admin:admin123@cluster0.klti4ly.mongodb.net/phonerakshak?retryWrites=true&w=majority&appName=Cluster0';

async function seedDatabase() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MOCK_MONGO_URI);
    console.log('Connected!');

    console.log('Clearing old mock data...');
    await Device.deleteMany({ deviceId: { $regex: /^MOCK_/ } });
    await Command.deleteMany({ deviceId: { $regex: /^MOCK_/ } });

    console.log('Inserting mock devices...');
    const devices = await Device.insertMany([
      {
        deviceId: 'MOCK_DEVICE_01',
        phoneNumber: '+91 9876543210',
        emergencyNumber: '+91 9999999999',
        deviceModel: 'Samsung Galaxy S24 Ultra',
        city: 'Mumbai',
        lastSeen: new Date()
      },
      {
        deviceId: 'MOCK_DEVICE_02',
        phoneNumber: '+91 8765432109',
        emergencyNumber: '+91 8888888888',
        deviceModel: 'OnePlus 12',
        city: 'Delhi',
        lastSeen: new Date(Date.now() - 1000 * 60 * 60 * 2) // 2 hours ago
      },
      {
        deviceId: 'MOCK_DEVICE_03',
        phoneNumber: '+91 7654321098',
        emergencyNumber: '+91 7777777777',
        deviceModel: 'Google Pixel 8 Pro',
        city: 'Bangalore',
        lastSeen: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3) // 3 days ago
      }
    ]);

    console.log('Inserting mock commands (Photos, Locations, Logs)...');
    
    // Commands for Device 1 (Live & Active)
    await Command.insertMany([
      {
        deviceId: 'MOCK_DEVICE_01',
        type: 'get_location',
        status: 'done',
        result: { lat: 19.0760, lng: 72.8777, accuracy: 12.5 },
        queuedAt: new Date(Date.now() - 5000),
        ackedAt: new Date(Date.now() - 4000)
      },
      {
        deviceId: 'MOCK_DEVICE_01',
        type: 'capture_photo',
        status: 'done',
        result: { 
          photoUrl: 'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?q=80&w=400&auto=format&fit=crop', // Stock face photo
          camera: 'front' 
        },
        queuedAt: new Date(Date.now() - 15000),
        ackedAt: new Date(Date.now() - 10000)
      },
      {
        deviceId: 'MOCK_DEVICE_01',
        type: 'start_alarm',
        status: 'delivered',
        queuedAt: new Date(),
        ackedAt: null
      }
    ]);

    // Commands for Device 2 (Missing)
    await Command.insertMany([
      {
        deviceId: 'MOCK_DEVICE_02',
        type: 'lock_screen',
        status: 'done',
        result: { success: true },
        queuedAt: new Date(Date.now() - 1000 * 60 * 60),
        ackedAt: new Date(Date.now() - 1000 * 60 * 59)
      },
      {
        deviceId: 'MOCK_DEVICE_02',
        type: 'get_call_logs',
        status: 'done',
        result: [
          { number: '+91 9123456789', type: 'MISSED', duration: '0s', date: new Date().toISOString() },
          { number: 'Unknown', type: 'INCOMING', duration: '45s', date: new Date(Date.now() - 100000).toISOString() }
        ],
        queuedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
        ackedAt: new Date(Date.now() - 1000 * 60 * 60 * 1.9)
      }
    ]);

    console.log('Mock data successfully seeded!');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding data:', err);
    process.exit(1);
  }
}

seedDatabase();
