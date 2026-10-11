/// <reference lib="webworker" />
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

declare const self: ServiceWorkerGlobalScope;

if (
  import.meta.env["VITE_FIREBASE_PROJECT_ID"] !== "attendai-41f64" ||
  import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"] !== "849652695985" ||
  import.meta.env["VITE_FIREBASE_APP_ID"] !== "1:849652695985:web:8b73aa6ecf97a2f313f390"
) {
  throw new Error("Guardian messaging project is not verified");
}

const app = initializeApp({
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"],
  authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"],
  storageBucket: import.meta.env["VITE_FIREBASE_STORAGE_BUCKET"],
  projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"],
  messagingSenderId: import.meta.env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
  appId: import.meta.env["VITE_FIREBASE_APP_ID"],
});
const messaging = getMessaging(app);

// FCM displays notification payloads in background and handles the safe
// webpush.fcmOptions.link supplied by the trusted server. Do not display twice.
onBackgroundMessage(messaging, () => {});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
