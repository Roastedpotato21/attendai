/** Public Firebase Web configuration for the guardian receiver only. */
import { getApp, getApps, initializeApp } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

export const firebaseWebConfig = {
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"],
  authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"],
  storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"],
  projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"],
  messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
  appId: import.meta.env["VITE_FIREBASE_APP_ID"],
};

export const firebaseVapidKey = import.meta.env["VITE_FIREBASE_VAPID_KEY"];

export async function guardianMessaging() {
  if (
    firebaseWebConfig.projectId !== "attendai-41f64" ||
    firebaseWebConfig.messagingSenderId !== "849652695985" ||
    firebaseWebConfig.appId !== "1:849652695985:web:8b73aa6ecf97a2f313f390" ||
    !firebaseWebConfig.apiKey ||
    !firebaseWebConfig.appId ||
    !firebaseVapidKey
  )
    throw new Error("Guardian notifications are not configured");
  if (!(await isSupported())) throw new Error("Notifications are unavailable in this browser");
  const app = getApps().length ? getApp() : initializeApp(firebaseWebConfig);
  return getMessaging(app);
}
