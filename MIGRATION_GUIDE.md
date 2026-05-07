# PhoneRakshak Firebase Migration Guide

This guide covers everything needed to fully migrate PhoneRakshak from the legacy Mongoose/EJS backend to the new serverless React + Firebase stack.

## 1. Firebase Console Setup
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project (`phonerakshak-7d84a`).
3. **Authentication**:
   - Go to Authentication > Sign-in method.
   - Enable **Phone** authentication.
4. **Firestore Database**:
   - Go to Firestore Database.
   - Click "Create database" if not already created (choose production mode).
   - Go to the "Rules" tab and paste the contents of `firebase/firestore.rules`.
5. **Firebase Storage**:
   - Ensure it's enabled for intruder photos and audio recordings.

## 2. Environment Variables
Create a `.env` file in the `/frontend` directory with the following variables:
```env
VITE_FIREBASE_API_KEY=AIzaSyCPQrUnoCToupXtBv-d3m9XarxZygkTDs4
VITE_FIREBASE_AUTH_DOMAIN=phonerakshak-7d84a.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=phonerakshak-7d84a
VITE_FIREBASE_STORAGE_BUCKET=phonerakshak-7d84a.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=423493114105
VITE_FIREBASE_APP_ID=1:423493114105:web:ab8f913c30262700a46a28
```

## 3. Required Firestore Indexes
When the dashboard loads devices ordered by `lastSeen`, Firestore may require a composite index. You will see a link in the browser console when this happens. Click the link to automatically generate the index, OR manually create it:
- **Collection**: `devices`
- **Fields**: `userId` (Ascending), `lastSeen` (Descending)
- **Scope**: Collection Group

## 4. Deploying Cloud Functions
The new heartbeat and device registration logic is handled by Cloud Functions.
1. Navigate to `/firebase/functions`.
2. Ensure you are logged into Firebase CLI: `firebase login`.
3. Set your project: `firebase use phonerakshak-7d84a`.
4. Deploy the functions: `firebase deploy --only functions`.

## 5. Testing Checklist
- [ ] Load the React app (`npm run dev` in `/frontend`).
- [ ] Attempt Phone OTP login. Ensure Recaptcha succeeds.
- [ ] Verify you are redirected to the Dashboard.
- [ ] Open Firebase Console -> Firestore, manually create a document at `users/{your-uid}/devices/test-device-1`.
  - Add fields: `deviceModel` (string), `online` (boolean), `lastSeen` (number - current epoch ms).
- [ ] Verify the device instantly appears on your React dashboard without refreshing.
- [ ] Wait 2 minutes and verify the Cloud Function automatically sets `online` to `false` due to heartbeat timeout.
