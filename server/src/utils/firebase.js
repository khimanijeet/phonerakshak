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
    return false;
  }
}

module.exports = {
  sendPushCommand,
  admin
};
