import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { onMessage, onRegistered, onUnregistered, register, unregister } from "firebase/messaging";
import { Bell, BellOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { firebaseVapidKey, guardianMessaging } from "@/lib/firebase-client";
import workerUrl from "@/lib/firebase-messaging-sw.ts?worker&url";

export const Route = createFileRoute("/guardian-notifications")({
  head: () => ({ meta: [{ title: "Guardian notifications — AttendAI" }] }),
  component: GuardianNotifications,
});

type Status = "checking" | "ready" | "enabled" | "denied" | "unavailable" | "invalid";

async function post(path: string, payload: Record<string, unknown> = {}) {
  return fetch(`/api/guardian/notifications/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function GuardianNotifications() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const invitation = useRef<string | null>(null);
  const registered = useRef(false);

  const connect = useCallback(async (invite: string | null) => {
    if (registered.current) return;
    registered.current = true;
    if (invite) invitation.current = invite;
    try {
      const messaging = await guardianMessaging();
      const serviceWorkerRegistration = await navigator.serviceWorker.register(workerUrl, {
        type: "module",
      });
      await new Promise<void>((resolve, reject) => {
        let initial = true;
        let handling = false;
        const timer = window.setTimeout(() => {
          unsubscribe();
          reject(new Error("Registration timed out"));
        }, 25_000);
        const unsubscribe = onRegistered(messaging, (installationId) => {
          if (handling) return;
          handling = true;
          void (async () => {
            const enrollmentToken = invitation.current;
            const response = await post(enrollmentToken ? "enroll" : "refresh", {
              ...(enrollmentToken ? { invitation: enrollmentToken } : {}),
              installationId,
              ...(enrollmentToken ? {} : { permission: "granted" }),
            });
            if (!response.ok) throw new Error("Device enrollment could not be saved");
            invitation.current = null;
            setStatus("enabled");
            if (initial) {
              initial = false;
              window.clearTimeout(timer);
              resolve();
            }
          })()
            .catch((error: unknown) => {
              if (initial) {
                initial = false;
                window.clearTimeout(timer);
                unsubscribe();
                reject(error);
              } else
                setMessage(
                  "This device needs a new enrollment link to keep notifications enabled.",
                );
            })
            .finally(() => {
              handling = false;
            });
        });
        register(messaging, { vapidKey: firebaseVapidKey, serviceWorkerRegistration }).catch(
          (error: unknown) => {
            window.clearTimeout(timer);
            unsubscribe();
            reject(error);
          },
        );
      });
      onMessage(messaging, (payload) => {
        setMessage(payload.notification?.body ?? "An attendance update is available.");
      });
      onUnregistered(messaging, () => {
        void post("permission", { permission: "default" });
        setStatus("invalid");
      });
    } catch (error) {
      registered.current = false;
      setStatus("unavailable");
      setMessage(error instanceof Error ? error.message : "Notifications are unavailable");
    }
  }, []);

  useEffect(() => {
    let live = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    invitation.current = fragment.get("invite");
    if (invitation.current) window.history.replaceState({}, "", window.location.pathname);
    void (async () => {
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !window.isSecureContext
      ) {
        if (live) setStatus("unavailable");
        return;
      }
      if (invitation.current) {
        const response = await post("validate", { invitation: invitation.current });
        const result = (await response.json()) as { valid?: boolean };
        if (!result.valid) {
          if (live) setStatus("invalid");
          return;
        }
        if (live) setStatus(Notification.permission === "denied" ? "denied" : "ready");
        return;
      }
      const response = await post("status");
      if (!response.ok) {
        if (live) setStatus("invalid");
        return;
      }
      if (Notification.permission !== "granted") {
        const permissionResponse = await post("permission", {
          permission: Notification.permission,
        });
        if (!permissionResponse.ok) throw new Error("Could not update notification permission");
        // Removing permission revokes the server device. Re-enrollment requires
        // a new invitation, so do not offer an enable button without one.
        if (live) setStatus(Notification.permission === "denied" ? "denied" : "invalid");
        return;
      }
      if (live) {
        void connect(null);
      }
    })().catch(() => {
      if (live) setStatus("unavailable");
    });
    return () => {
      live = false;
    };
  }, [connect]);

  const enable = async () => {
    if (!invitation.current || busy) return;
    setBusy(true);
    try {
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      await connect(invitation.current);
    } catch (error) {
      setStatus("unavailable");
      setMessage(error instanceof Error ? error.message : "Notifications are unavailable");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      const response = await post("revoke");
      if (!response.ok) throw new Error("Could not disable notifications");
      try {
        await unregister(await guardianMessaging());
      } catch {
        /* Server revocation is authoritative. */
      }
      setStatus("invalid");
      setMessage("Notifications disabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable notifications");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {status === "enabled" ? <Bell className="h-6 w-6" /> : <BellOff className="h-6 w-6" />}
          </div>
          <CardTitle>AttendAI notifications</CardTitle>
          <CardDescription>
            AttendAI can send attendance notifications to this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {status === "checking" && <p>Checking your device…</p>}
          {status === "ready" && (
            <>
              <p className="text-sm text-muted-foreground">
                Enable notifications once to receive future attendance alerts.
              </p>
              <Button onClick={() => void enable()} disabled={busy}>
                Enable notifications
              </Button>
            </>
          )}
          {status === "enabled" && (
            <>
              <p className="text-sm font-medium">Notifications enabled</p>
              <Button variant="outline" onClick={() => void revoke()} disabled={busy}>
                Disable on this device
              </Button>
            </>
          )}
          {status === "denied" && (
            <p className="text-sm">
              Permission denied. Change this site’s notification setting in your browser, then use a
              new invitation if needed.
            </p>
          )}
          {status === "unavailable" && (
            <p className="text-sm">
              Notifications are unavailable on this device. Check browser support and secure
              connection.
            </p>
          )}
          {status === "invalid" && (
            <p className="text-sm">
              No active device or valid invitation. Ask your institution for a new enrollment link.
            </p>
          )}
          {message && (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
