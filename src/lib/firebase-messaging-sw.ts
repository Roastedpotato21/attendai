/// <reference lib="webworker" />
import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";

declare const self: ServiceWorkerGlobalScope;

// Notifications displayed by the foreground page need their own safe click route.
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data as
    { attendaiTestId?: string; attendaiTestMode?: string } | undefined;
  if (
    !data?.attendaiTestId ||
    !/^[0-9a-f-]{36}$/i.test(data.attendaiTestId) ||
    !["guardian", "online", "offline"].includes(data.attendaiTestMode ?? "")
  )
    return;
  event.stopImmediatePropagation();
  event.notification.close();
  const link = new URL("/guardian-notifications", self.location.origin);
  link.searchParams.set("test", data.attendaiTestMode!);
  link.searchParams.set("id", data.attendaiTestId);
  event.waitUntil(self.clients.openWindow(link.toString()));
});

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
