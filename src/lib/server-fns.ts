import { createServerFn } from "@tanstack/react-start";
import type { Language } from "./types";

export const sendTestSmsFn = createServerFn({ method: "POST" })
  .validator((d: { recipientName: string; studentName: string; language?: Language }) => d)
  .handler(async () => {
    throw new Error("Direct test SMS is disabled. Use the consent-checked communication outbox.");
  });
