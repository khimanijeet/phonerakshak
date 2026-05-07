const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();

// 1. Hearbeat check - Scheduled function to mark inactive devices offline
exports.onDeviceHeartbeat = functions.pubsub.schedule("every 2 minutes").onRun(async (context) => {
  const cutoff = Date.now() - (60 * 1000); // 1 minute ago
  const usersSnapshot = await db.collection("users").get();
  
  const batch = db.batch();
  let updates = 0;

  for (const userDoc of usersSnapshot.docs) {
    const devicesSnapshot = await db.collection(`users/${userDoc.id}/devices`).get();
    devicesSnapshot.forEach((deviceDoc) => {
      const data = deviceDoc.data();
      if (data.online === true && data.lastSeen < cutoff) {
        batch.update(deviceDoc.ref, { online: false });
        updates++;
      }
    });
  }

  if (updates > 0) {
    await batch.commit();
    console.log(`Marked ${updates} devices offline.`);
  }
  return null;
});

// 2. onDeviceRegistered - triggered when a new device is added
exports.onDeviceRegistered = functions.firestore
  .document("users/{uid}/devices/{deviceId}")
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const uid = context.params.uid;
    
    // Add additional validation or send welcome notification here
    console.log(`New device registered: ${context.params.deviceId} for user ${uid}`);
    
    return snap.ref.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      online: true,
      lastSeen: Date.now()
    }, { merge: true });
  });

// 3. Admin creation helper
exports.setAdminClaim = functions.https.onCall(async (data, context) => {
  // In production, protect this endpoint!
  // Example: if (context.auth.token.email !== 'admin@phonerakshak.com') throw new functions.https.HttpsError('permission-denied');
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  }
  await admin.auth().setCustomUserClaims(context.auth.uid, { admin: true });
  return { message: "Success! Admin claim granted." };
});
