require('dotenv').config({ path: '../../.env' });
const mongoose = require('mongoose');
const admin = require('../utils/firebase').admin;
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

async function purgeMongoDB() {
  console.log('Starting MongoDB Purge...');
  const collections = [
    Alert, AudioRecording, BlockedNumber, Command,
    Customer, Device, Intruder, Location, Report,
    SecurityLog, SupportTicket
  ];

  let deletedCount = 0;
  for (const Model of collections) {
    const res = await Model.deleteMany({});
    console.log(`Deleted ${res.deletedCount} documents from ${Model.modelName}`);
    deletedCount += res.deletedCount;
  }

  const configRes = await Config.deleteMany({ key: { $ne: 'admin_2fa_secret' } });
  console.log(`Deleted ${configRes.deletedCount} documents from Config (kept vital secrets)`);
  
  return deletedCount;
}

async function deleteFirestoreCollection(collectionPath) {
  const db = admin.firestore();
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(100);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

async function purgeFirestore() {
  if (admin.apps.length === 0) {
    console.warn('Firebase Admin not initialized. Skipping Firestore purge.');
    return 0;
  }
  console.log('Starting Firestore Purge...');
  const db = admin.firestore();
  
  // Recursively delete users collection
  const usersSnapshot = await db.collection('users').get();
  console.log(`Found ${usersSnapshot.size} users in Firestore`);
  
  for (const userDoc of usersSnapshot.docs) {
    // Delete subcollections first
    const devicesSnapshot = await userDoc.ref.collection('devices').get();
    for (const deviceDoc of devicesSnapshot.docs) {
      await deleteFirestoreCollection(`users/${userDoc.id}/devices/${deviceDoc.id}/commands`);
      await deleteFirestoreCollection(`users/${userDoc.id}/devices/${deviceDoc.id}/events`);
      await deleteFirestoreCollection(`users/${userDoc.id}/devices/${deviceDoc.id}/locations`);
      await deviceDoc.ref.delete();
    }
    await deleteFirestoreCollection(`users/${userDoc.id}/subscription`);
    await userDoc.ref.delete();
  }
  
  console.log('Firestore Purge complete.');
  return usersSnapshot.size;
}

async function purgeStorage() {
  if (admin.apps.length === 0) {
    console.warn('Firebase Admin not initialized. Skipping Storage purge.');
    return 0;
  }
  console.log('Starting Firebase Storage Purge...');
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles();
  
  console.log(`Found ${files.length} files in storage`);
  for (const file of files) {
    await file.delete();
  }
  
  console.log('Storage Purge complete.');
  return files.length;
}

async function run() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    const mongoURI = 'mongodb+srv://admin:admin123@cluster0.klti4ly.mongodb.net/phonerakshak?retryWrites=true&w=majority&appName=Cluster0';
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB');

    // Specific user deletion as requested
    const targetPhone = '+916353858573';
    const customer = await Customer.findOne({ phoneNumber: targetPhone });
    if (customer) {
      console.log(`Target user ${targetPhone} found. Performing deep delete...`);
      await Device.deleteMany({ userId: customer._id });
      await Alert.deleteMany({ userId: customer._id });
      await SecurityLog.deleteMany({ userId: customer._id });
      await customer.deleteOne();
      console.log(`User ${targetPhone} and linked data deleted.`);
    }

    const mongoCount = await purgeMongoDB();
    const firestoreCount = await purgeFirestore();
    const storageCount = await purgeStorage();

    console.log('==========================================');
    console.log('FULL RESET COMPLETE');
    console.log(`MongoDB Documents Deleted: ${mongoCount}`);
    console.log(`Firestore Users Deleted: ${firestoreCount}`);
    console.log(`Storage Files Deleted: ${storageCount}`);
    console.log('==========================================');

    process.exit(0);
  } catch (error) {
    console.error(`Purge failed: ${error.message}`);
    process.exit(1);
  }
}

run();
