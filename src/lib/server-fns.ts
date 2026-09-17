import { createServerFn } from "@tanstack/react-start";
import { smsService } from "./services/sms";
import type { Language } from "./types";

export const sendTestSmsFn = createServerFn({ method: "POST" })
  .validator((d: { recipientName: string; studentName: string; language?: Language }) => d)
  .handler(async ({ data }) => {
    try {
      // Fetch test recipient from environment variable to ensure we never leak to real users
      const testRecipient = process.env["SMS_TEST_RECIPIENT"];

      if (!testRecipient) {
        throw new Error("SMS_TEST_RECIPIENT environment variable is not configured.");
      }

      const result = await smsService.send({
        to: testRecipient,
        parentName: data.recipientName,
        studentName: data.studentName,
        date: new Date().toISOString().split("T")[0] as string,
        absenceStatus: "absent",
        language: data.language || "English",
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown server error";
      console.error("[Test SMS] Server error:", errorMessage);
      throw new Error(errorMessage);
    }
  });
