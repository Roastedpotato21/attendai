import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { onMessage, onRegistered, onUnregistered, register, unregister } from "firebase/messaging";
import { Bell, BellOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { firebaseVapidKey, guardianMessaging } from "@/lib/firebase-client";
import { GUARDIAN_NOTIFICATION_CONSENT_VERSION } from "@/lib/guardian-consent";
import { showGuardianTestNotification } from "@/lib/guardian-test-notification";
import workerUrl from "@/lib/firebase-messaging-sw.ts?worker&url";

export const Route = createFileRoute("/guardian-notifications")({
  head: () => ({
    meta: [
      { title: "Guardian notifications — AttendAI" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [{ rel: "manifest", href: "/guardian-notifications.webmanifest" }],
  }),
  component: GuardianNotifications,
});

type Status = "checking" | "ready" | "enabled" | "denied" | "unavailable" | "invalid";
type InvitationContext = { institution: string; students: string[] };

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
  const [context, setContext] = useState<InvitationContext | null>(null);
  const [consented, setConsented] = useState(false);
  const [showHomeScreenHelp, setShowHomeScreenHelp] = useState(false);
  const [pastedLink, setPastedLink] = useState("");
  const [receivedTestId, setReceivedTestId] = useState<string | null>(null);
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
        scope: "/",
      });
      await navigator.serviceWorker.ready;
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
              ...(enrollmentToken
                ? { consent: true, consentVersion: GUARDIAN_NOTIFICATION_CONSENT_VERSION }
                : { permission: "granted" }),
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
        const testId = payload.data?.["testId"];
        if (testId) {
          setMessage(
            payload.notification?.body ??
              "AttendAI notification test received. No attendance action is required.",
          );
          void showGuardianTestNotification(payload, serviceWorkerRegistration)
            .then(() => {
              if (["guardian", "offline"].includes(payload.data?.["testMode"] ?? ""))
                setReceivedTestId(testId);
            })
            .catch(() =>
              setMessage(
                "The test reached this page, but a system notification could not be displayed. Check Chrome and Android notification settings.",
              ),
            );
          return;
        }
        const communicationId = payload.data?.["communicationId"];
        if (!communicationId) {
          setMessage("An attendance update is available.");
          return;
        }
        void post("event-status", { communicationId })
          .then(async (response) => {
            if (!response.ok) throw new Error("Event status unavailable");
            const result = (await response.json()) as { currentStatus?: string; message?: string };
            setMessage(
              result.message ??
                (result.currentStatus === "absent"
                  ? (payload.notification?.body ?? "An attendance update is available.")
                  : "Attendance has changed. Check the current record with your institution."),
            );
            void post("acknowledge", { communicationId });
          })
          .catch(() =>
            setMessage(
              "An attendance update is available. Check the current record with your institution.",
            ),
          );
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
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && navigator.standalone === true);
      if (live) setShowHomeScreenHelp(!standalone);
      if (invitation.current) {
        const response = await post("validate", { invitation: invitation.current });
        const result = (await response.json()) as {
          valid?: boolean;
          institution?: string;
          students?: string[];
          consentVersion?: string;
        };
        if (
          !result.valid ||
          !result.institution ||
          !Array.isArray(result.students) ||
          !result.students.length ||
          result.consentVersion !== GUARDIAN_NOTIFICATION_CONSENT_VERSION
        ) {
          if (live) setStatus("invalid");
          return;
        }
        if (live) setContext({ institution: result.institution, students: result.students });
      }
      if (
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !window.isSecureContext
      ) {
        if (live) setStatus("unavailable");
        return;
      }
      if (invitation.current) {
        if (live) setStatus(Notification.permission === "denied" ? "denied" : "ready");
        return;
      }
      const response = await post("status");
      if (!response.ok) {
        if (live) setStatus("invalid");
        return;
      }
      const deviceStatus = (await response.json()) as {
        enabled?: boolean;
        consentRequired?: boolean;
      };
      if (!deviceStatus.enabled) {
        if (live && deviceStatus.consentRequired)
          setMessage(
            "This device needs your notification consent. Ask your institution for a new private enrollment link and accept the notice on this phone.",
          );
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
        const eventId = new URLSearchParams(window.location.search).get("event");
        const testId = new URLSearchParams(window.location.search).get("id");
        if (
          testId &&
          ["offline", "guardian"].includes(
            new URLSearchParams(window.location.search).get("test") ?? "",
          )
        ) {
          setMessage(
            new URLSearchParams(window.location.search).get("test") === "guardian"
              ? "AttendAI notification test received. No attendance action is required."
              : "AttendAI Offline Delivery Test: This test checks delayed notification delivery after internet reconnects.",
          );
          void post("test-acknowledge", { testId });
        }
        if (eventId) {
          void post("event-status", { communicationId: eventId })
            .then(async (eventResponse) => {
              if (!eventResponse.ok) throw new Error("Event status unavailable");
              const result = (await eventResponse.json()) as {
                currentStatus?: string;
                message?: string;
              };
              if (live)
                setMessage(
                  result.message ??
                    (result.currentStatus === "absent"
                      ? "The absence is still recorded. Contact the institution if this is incorrect."
                      : "This attendance record has changed. Contact the institution for the current details."),
                );
            })
            .catch(() => {
              if (live) setMessage("Check the current attendance record with your institution.");
            });
        }
      }
    })().catch(() => {
      if (live) setStatus("unavailable");
    });
    return () => {
      live = false;
    };
  }, [connect]);

  const enable = async () => {
    if (!invitation.current || !context || !consented || busy) return;
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

  const confirmTest = async () => {
    if (!receivedTestId || busy) return;
    setBusy(true);
    try {
      const response = await post("test-acknowledge", { testId: receivedTestId });
      if (!response.ok) throw new Error("Could not save confirmation. Please try again.");
      setReceivedTestId(null);
      setMessage("Thank you. Receipt of the test notification is confirmed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm receipt");
    } finally {
      setBusy(false);
    }
  };

  const openPastedInvitation = () => {
    try {
      const url = new URL(pastedLink.trim(), window.location.origin);
      const token = new URLSearchParams(url.hash.slice(1)).get("invite");
      if (
        url.origin !== window.location.origin ||
        url.pathname !== "/guardian-notifications" ||
        !token ||
        !/^[A-Za-z0-9_-]{43}$/.test(token)
      )
        throw new Error("Invalid invitation link");
      // A fragment-only navigation does not rerun this route's invitation check.
      window.history.replaceState({}, "", `/guardian-notifications#invite=${token}`);
      window.location.reload();
    } catch {
      setMessage("Paste the full private enrollment link shared by your institution.");
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {status === "enabled" ? <Bell className="h-6 w-6" /> : <BellOff className="h-6 w-6" />}
          </div>
          <CardTitle>AttendAI Attendance Notifications</CardTitle>
          <CardDescription>
            Your institution uses AttendAI to manage attendance. You can choose to receive alerts on
            this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {context && (
            <div className="rounded-md border p-3 text-left text-sm">
              <p>
                <strong>Institution:</strong> {context.institution}
              </p>
              <p className="mt-2 font-medium">
                Linked student{context.students.length === 1 ? "" : "s"}:
              </p>
              <ul className="list-inside list-disc">
                {context.students.map((student) => (
                  <li key={student}>{student}</li>
                ))}
              </ul>
            </div>
          )}
          {status === "checking" && <p>Checking your device…</p>}
          {status === "ready" && (
            <>
              <p className="text-left text-sm text-muted-foreground">
                Alerts may include a linked student's name, attendance status, and date. Delivery
                uses Google Firebase Cloud Messaging and depends on browser support and an internet
                connection. Notifications may appear on your lock screen. You can withdraw consent
                using Disable on this device or remove notification permission in your device
                settings. Enrollment does not create a staff account or give access to the
                institution's application. Read the{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Privacy Policy
                </a>
                .
              </p>
              <label className="flex items-start gap-3 text-left text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  I consent to receiving attendance notifications for my linked student(s) from this
                  institution on this device.
                </span>
              </label>
              <Button onClick={() => void enable()} disabled={busy || !consented}>
                {busy ? "Enabling notifications…" : "Enable Notifications"}
              </Button>
              <p className="text-xs text-muted-foreground">
                On Android, open this link in Chrome and choose Allow when prompted. No phone number
                or app download is needed.
              </p>
            </>
          )}
          {status === "enabled" && (
            <>
              <p className="text-sm font-medium">Notifications enabled</p>
              <p className="text-sm text-muted-foreground">
                Consent saved for this device. You can now receive your institution's notifications.
                For a test, check your notification shade and tap the notification to confirm
                receipt.
              </p>
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
          {(status === "unavailable" || status === "denied") && showHomeScreenHelp && (
            <div className="rounded-md bg-muted p-3 text-left text-sm">
              <p className="font-medium">Using an iPhone or iPad?</p>
              <ol className="mt-2 list-inside list-decimal space-y-1">
                <li>Add AttendAI Notifications to your Home Screen.</li>
                <li>Open it from the Home Screen.</li>
                <li>Paste the same private enrollment link below if the app asks for it.</li>
                <li>Tap Enable Notifications, then choose Allow.</li>
              </ol>
            </div>
          )}
          {status === "invalid" && (
            <p className="text-sm">
              No active device or valid invitation. Ask your institution for a new enrollment link.
            </p>
          )}
          {status === "invalid" && (
            <div className="space-y-2 text-left text-sm">
              <label htmlFor="guardian-invitation" className="font-medium">
                Already have a private enrollment link?
              </label>
              <input
                id="guardian-invitation"
                type="text"
                autoComplete="off"
                value={pastedLink}
                onChange={(event) => setPastedLink(event.target.value)}
                placeholder="Paste your enrollment link"
                className="w-full rounded-md border bg-background px-3 py-2"
              />
              <Button
                variant="outline"
                onClick={openPastedInvitation}
                disabled={!pastedLink.trim()}
              >
                Open enrollment link
              </Button>
            </div>
          )}
          {message && (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {message}
            </p>
          )}
          {receivedTestId && status === "enabled" && (
            <Button onClick={() => void confirmTest()} disabled={busy}>
              I saw the test notification
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
