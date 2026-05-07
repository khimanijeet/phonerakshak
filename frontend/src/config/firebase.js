import { initializeApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// The user should replace this with their actual config in production, 
// using environment variables. For now, we will use the ENV vars from their .env file.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCPQrUnoCToupXtBv-d3m9XarxZygkTDs4",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "phonerakshak-7d84a.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "phonerakshak-7d84a",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "phonerakshak-7d84a.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "423493114105",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:423493114105:web:ab8f913c30262700a46a28"
};

console.log("Initializing Firebase with config:", firebaseConfig.projectId);

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Setup Recaptcha
export const setupRecaptcha = (containerId) => {
  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      'size': 'invisible',
      'callback': (response) => {
        console.log("Recaptcha verified", response);
      },
      'expired-callback': () => {
        console.log("Recaptcha expired");
      }
    });
  }
};
