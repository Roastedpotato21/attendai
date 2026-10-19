import type { MessagePayload } from "firebase/messaging";

/** Foreground messages need an explicit system notification; background FCM displays its own. */
export async function showGuardianTestNotification(
  payload: MessagePayload,
  registration: Pick<ServiceWorkerRegistration, "showNotification">,
): Promise<void> {
  const testId = payload.data?.["testId"];
  const mode = payload.data?.["testMode"];
  if (
    !testId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId) ||
    !mode ||
    !["guardian", "online", "offline"].includes(mode)
  )
    throw new Error("Invalid notification test");
  await registration.showNotification(payload.notification?.title ?? "AttendAI Notification Test", {
    body:
      payload.notification?.body ??
      "This is a test notification. No attendance action is required.",
    tag: `${mode}-test-${testId}`,
    icon: "/guardian-icon.svg",
    data: { attendaiTestId: testId, attendaiTestMode: mode },
  });
}
