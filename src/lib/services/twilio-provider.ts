/**
 * Twilio SMS Provider - Real SMS Integration
 *
 * Features:
 * - Production-grade Twilio SMS sending
 * - TEST_MODE support for development (routes messages to test recipient only)
 * - Comprehensive error handling and logging
 * - Message delivery status tracking (Sent, Delivered, Failed, provider-error)
 * - Webhook support for delivery updates
 *
 * Environment Variables:
 * - TWILIO_ACCOUNT_SID: Twilio Account SID
 * - TWILIO_AUTH_TOKEN: Twilio Auth Token
 * - TWILIO_PHONE_NUMBER: Twilio phone number (e.g., +1234567890)
 * - SMS_TEST_MODE: true/false - routes all messages to TEST_RECIPIENT only
 * - SMS_TEST_RECIPIENT: Phone number for test messages (e.g., +919876543210)
 * - SMS_LOG_LEVEL: debug|info|warn|error (default: info)
 */

import type { Language } from "@/lib/types";

export interface TwilioSmsInput {
  to: string;
  body: string;
  studentName?: string;
  parentName?: string;
  language?: Language;
  metadata?: Record<string, string>;
}

export interface TwilioSmsResult {
  ok: boolean;
  messageId: string;
  provider: string;
  status: "sent" | "queued" | "failed" | "provider-error";
  timestamp: string;
  errorMessage?: string;
  recipientNumber: string;
  isTestMode: boolean;
  logId: string;
}

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

type TwilioMessageStatus = "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed";

type TwilioApiResponse = {
  sid?: string;
  status?: string;
  date_created?: string;
  code?: string | number;
  message?: string;
  error_code?: string;
  error_message?: string;
};

const isTwilioMessageStatus = (status: unknown): status is TwilioMessageStatus =>
  typeof status === "string" &&
  ["queued", "sending", "sent", "delivered", "undelivered", "failed"].includes(status);

// Logger utility
const createLogger = () => {
  const logLevel = (process.env["SMS_LOG_LEVEL"] || "info") as "debug" | "info" | "warn" | "error";
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const currentLevel = levels[logLevel];

  return {
    debug: (msg: string, data?: unknown) => {
      if (currentLevel <= 0) {
        console.log(`[SMS-DEBUG] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
      }
    },
    info: (msg: string, data?: unknown) => {
      if (currentLevel <= 1) {
        console.log(`[SMS-INFO] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
      }
    },
    warn: (msg: string, data?: unknown) => {
      if (currentLevel <= 2) {
        console.warn(`[SMS-WARN] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
      }
    },
    error: (msg: string, data?: unknown) => {
      if (currentLevel <= 3) {
        console.error(`[SMS-ERROR] ${msg}`, data ? JSON.stringify(data, null, 2) : "");
      }
    },
  };
};

const logger = createLogger();

// Helper: Generate unique log ID for tracing
const generateLogId = () =>
  `twilio-${Date.now()}-${Math.random().toString(36).slice(2, 9).toUpperCase()}`;

// Helper: Format phone number (basic E.164 validation)
const formatPhoneNumber = (phone: string): string => {
  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, "");
  // If no country code, assume India (+91)
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  // If already has country code
  if (cleaned.length > 10) {
    return `+${cleaned}`;
  }
  // Fallback - assume already formatted
  return phone.includes("+") ? phone : `+91${cleaned}`;
};

/**
 * Real Twilio SMS Provider
 * Sends actual SMS via Twilio API
 */
export const twilioSmsProvider = {
  async send(input: TwilioSmsInput): Promise<TwilioSmsResult> {
    const logId = generateLogId();
    const timestamp = new Date().toISOString();

    try {
      // 1. Validate configuration
      const accountSid = process.env["TWILIO_ACCOUNT_SID"];
      const authToken = process.env["TWILIO_AUTH_TOKEN"];
      const fromNumber = process.env["TWILIO_PHONE_NUMBER"];
      const testMode = process.env["SMS_TEST_MODE"] === "true";
      const testRecipient = process.env["SMS_TEST_RECIPIENT"];

      logger.info(`[${logId}] SMS send request initiated`, {
        studentName: input.studentName,
        parentName: input.parentName,
        originalRecipient: input.to,
        testMode,
        messagePreview: input.body.slice(0, 50),
      });

      if (!accountSid || !authToken || !fromNumber) {
        logger.error(`[${logId}] Missing Twilio configuration`, {
          hasSid: !!accountSid,
          hasToken: !!authToken,
          hasPhone: !!fromNumber,
        });

        return {
          ok: false,
          messageId: "",
          provider: "twilio",
          status: "provider-error",
          timestamp,
          errorMessage: "Twilio credentials not configured",
          recipientNumber: input.to,
          isTestMode: testMode,
          logId,
        };
      }

      // 2. Determine recipient (test mode routes to test recipient only)
      let recipientNumber = input.to;
      if (testMode) {
        if (!testRecipient) {
          logger.error(`[${logId}] Test mode enabled but SMS_TEST_RECIPIENT not configured`);
          return {
            ok: false,
            messageId: "",
            provider: "twilio",
            status: "provider-error",
            timestamp,
            errorMessage: "Test mode enabled but SMS_TEST_RECIPIENT not configured",
            recipientNumber: input.to,
            isTestMode: true,
            logId,
          };
        }
        recipientNumber = testRecipient;
        logger.info(`[${logId}] Test mode active - routing to test recipient`, {
          originalRecipient: input.to,
          testRecipient,
        });
      }

      // 3. Format phone number
      recipientNumber = formatPhoneNumber(recipientNumber);
      logger.debug(`[${logId}] Phone number formatted`, { recipientNumber });

      // 4. Prepare API request
      const params = new URLSearchParams({
        From: fromNumber,
        To: recipientNumber,
        Body: input.body,
      });

      // 5. Send via Twilio API
      logger.info(`[${logId}] Sending to Twilio API`, {
        from: fromNumber,
        to: recipientNumber,
      });

      const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        },
        body: params.toString(),
      });

      const data = (await response.json()) as TwilioApiResponse;

      if (!response.ok) {
        logger.error(`[${logId}] Twilio API error`, {
          status: response.status,
          errorCode: data.code,
          errorMessage: data.message,
        });

        return {
          ok: false,
          messageId: "",
          provider: "twilio",
          status: "provider-error",
          timestamp,
          errorMessage: `Twilio error [${data.code}]: ${data.message}`,
          recipientNumber,
          isTestMode: testMode,
          logId,
        };
      }

      // 6. Success response
      if (!data.sid) throw new Error("Twilio did not return a provider message ID.");
      const messageId = data.sid;
      logger.info(`[${logId}] SMS sent successfully`, {
        twilioSid: messageId,
        status: data.status,
        dateCreated: data.date_created,
        recipientNumber: testMode ? `[TEST] ${recipientNumber}` : recipientNumber,
      });

      return {
        ok: true,
        messageId,
        provider: "twilio",
        status: data.status === "queued" ? "queued" : "sent",
        timestamp,
        recipientNumber,
        isTestMode: testMode,
        logId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${logId}] Exception during SMS send`, { error: errorMessage });

      return {
        ok: false,
        messageId: "",
        provider: "twilio",
        status: "provider-error",
        timestamp,
        errorMessage: `Exception: ${errorMessage}`,
        recipientNumber: input.to,
        isTestMode: process.env["SMS_TEST_MODE"] === "true",
        logId,
      };
    }
  },

  /**
   * Poll message status from Twilio
   * Called after sending to get delivery status updates
   */
  async getMessageStatus(messageSid: string): Promise<{
    status: "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed";
    errorCode?: string;
    errorMessage?: string;
  }> {
    const logId = generateLogId();

    try {
      const accountSid = process.env["TWILIO_ACCOUNT_SID"];
      const authToken = process.env["TWILIO_AUTH_TOKEN"];

      if (!accountSid || !authToken) {
        throw new Error("Twilio credentials not configured");
      }

      const response = await fetch(
        `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages/${messageSid}.json`,
        {
          method: "GET",
          headers: {
            Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          },
        },
      );

      const data = (await response.json()) as TwilioApiResponse;

      logger.debug(`[${logId}] Retrieved message status`, {
        messageSid,
        status: data.status,
      });

      return {
        status: isTwilioMessageStatus(data.status) ? data.status : "failed",
        ...(data.error_code ? { errorCode: data.error_code } : {}),
        ...(data.error_message ? { errorMessage: data.error_message } : {}),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${logId}] Failed to get message status`, { error: errorMessage });
      throw error;
    }
  },
};

export function getTwilioProvider() {
  return {
    async send(_input: TwilioSmsInput): Promise<TwilioSmsResult> {
      throw new Error("Legacy SMS delivery is disabled. Use the server communication worker.");
    },
    async getMessageStatus(): Promise<{ status: string }> {
      throw new Error("Legacy SMS status lookup is disabled.");
    },
  };
}
