const admin = require('firebase-admin');
const logger = require('./logger');

// Initialize Firebase Admin
// We use a try-catch so the server doesn't crash if the service account is missing initially.
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    logger.info('Firebase Admin initialized successfully using JSON env var.');
  } else if (serviceAccountPath) {
    const serviceAccount = require(require('path').resolve(__dirname, '..', '..', serviceAccountPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    logger.info('Firebase Admin initialized successfully using Path env var.');
  } else {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON or PATH not set. FCM pushes will be simulated.');
  }
} catch (error) {
  logger.error('Failed to initialize Firebase Admin: ' + error.message);
}

/**
 * Send an FCM data message to a specific device token.
 * 
 * @param {string} token - The FCM registration token of the device.
 * @param {object} payload - The data payload to send.
 */
async function sendPushCommand(token, payload) {
  if (!token) return false;

  const message = {
    data: payload,
    token: token,
    android: {
      priority: 'high'
    }
  };

  try {
    if (admin.apps.length > 0) {
      const response = await admin.messaging().send(message);
      logger.info(`Successfully sent FCM message: ${response}`);
      return true;
    } else {
      logger.info(`[SIMULATED FCM] Push sent to token ${token} with payload: ${JSON.stringify(payload)}`);
      return true;
    }
  } catch (error) {
    logger.error(`Error sending FCM message: ${error.message}`);
  }
}

/**
 * Send a push notification specifically to an Android device.
 * Enforces the strict Android-only scope.
 */
async function sendAndroidPushAlert(deviceId, title, body, data = {}) {
  const Device = require('../models/Device');
  try {
    const device = await Device.findOne({ deviceId });
    if (!device || !device.fcmToken) {
      logger.warn(`No FCM token found for device ${deviceId}. Push skipped.`);
      return false;
    }

    const message = {
      notification: { title, body },
      data: data,
      token: device.fcmToken,
      android: {
        priority: 'high'
      }
    };

    if (admin.apps.length > 0) {
      const response = await admin.messaging().send(message);
      logger.info(`Android FCM Push sent to ${deviceId}. Response: ${response}`);
      return true;
    } else {
      logger.info(`[SIMULATED FCM] Android push to ${deviceId}: ${title} - ${body}`);
      return true;
    }
  } catch (error) {
    logger.error(`Error sending Android push to ${deviceId}: ${error.message}`);
    return false;
  }
}

/**
 * Sync device data to Firestore for the Customer Portal
 */
async function syncToFirestore(userId, deviceId, data, type = 'device') {
  try {
    if (admin.apps.length === 0) return;
    const db = admin.firestore();
    
    // Get the Firebase UID for this user
    const Customer = require('../models/Customer');
    const customer = await Customer.findById(userId);
    if (!customer || !customer.firebaseUid) {
      logger.warn(`No Firebase UID for user ${userId}. Firestore sync skipped.`);
      return;
    }

    const uid = customer.firebaseUid;

    if (type === 'device') {
      await db.doc(`users/${uid}/devices/${deviceId}`).set({
        ...data,
        lastSeen: Date.now()
      }, { merge: true });
    } else if (type === 'location') {
      await db.collection(`users/${uid}/devices/${deviceId}/locations`).add({
        ...data,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      // Also update last known location on device doc
      await db.doc(`users/${uid}/devices/${deviceId}`).set({
        lastLocation: data,
        lastSeen: Date.now()
      }, { merge: true });
    } else if (type === 'alert') {
      await db.collection(`users/${uid}/devices/${deviceId}/events`).add({
        ...data,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } else if (type === 'command') {
      await db.collection(`users/${uid}/devices/${deviceId}/commands`).add({
        ...data,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    logger.error(`Firestore Sync Error (${type}): ${error.message}`);
  }
}

/**
 * Start a global Firestore listener to handle commands and heartbeat.
 * This replaces the need for Firebase Cloud Functions (Spark Plan compatible).
 */
function initFirestoreWorkers() {
  if (admin.apps.length === 0) return;
  const db = admin.firestore();

  logger.info('Initializing Firestore Workers (Command Listener + Heartbeat)...');

  // 1. Listen for new commands across ALL users
  // Note: This uses a Collection Group query which requires a single index in Firebase Console
  db.collectionGroup('commands')
    .where('status', '==', 'pending')
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const commandDoc = change.doc;
          const command = commandDoc.data();
          const commandPath = commandDoc.ref.path; // e.g. users/UID/devices/DEVICE_ID/commands/CMD_ID
          const pathParts = commandPath.split('/');
          const uid = pathParts[1];
          const deviceId = pathParts[3];

          logger.info(`Processing command ${command.type} for device ${deviceId}`);

          try {
            // Get device FCM token
            const deviceDoc = await db.doc(`users/${uid}/devices/${deviceId}`).get();
            const deviceData = deviceDoc.data();

            if (!deviceData || !deviceData.fcmToken) {
              await commandDoc.ref.update({ status: 'failed', error: 'No FCM token' });
              return;
            }

            // Send FCM
            const message = {
              data: {
                commandId: commandDoc.id,
                type: command.type,
                timestamp: Date.now().toString()
              },
              token: deviceData.fcmToken,
              android: { priority: 'high', ttl: 300000 }
            };

            await admin.messaging().send(message);
            await commandDoc.ref.update({ 
              status: 'sent', 
              sentAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            logger.info(`Command ${command.type} sent to ${deviceId}`);
          } catch (err) {
            logger.error(`Failed to process command: ${err.message}`);
            await commandDoc.ref.update({ status: 'failed', error: err.message });
          }
        }
      });
    }, (err) => logger.error(`Command listener error: ${err.message}`));

  // 2. Heartbeat Worker (Runs every 2 minutes)
  setInterval(async () => {
    try {
      const cutoff = Date.now() - (60 * 1000); // 1 minute inactivity
      const usersSnapshot = await db.collection('users').get();
      
      for (const userDoc of usersSnapshot.docs) {
        const devicesSnapshot = await db.collection(`users/${userDoc.id}/devices`)
          .where('online', '==', true)
          .get();

        const batch = db.batch();
        let updates = 0;

        devicesSnapshot.forEach((deviceDoc) => {
          if (deviceDoc.data().lastSeen < cutoff) {
            batch.update(deviceDoc.ref, { online: false });
            updates++;
          }
        });

        if (updates > 0) await batch.commit();
      }
    } catch (err) {
      logger.error(`Heartbeat worker error: ${err.message}`);
    }
  }, 120000);
}

module.exports = {
  sendPushCommand,
  sendAndroidPushAlert,
  syncToFirestore,
  initFirestoreWorkers,
  admin
};
