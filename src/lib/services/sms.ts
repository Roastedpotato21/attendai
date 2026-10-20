/**
 * SMS Service - MSG91 Integration for India
 *
 * Handles SMS sending to parents with proper error handling,
 * deduplication, and never exposes API keys in frontend code.
 * This is server-side only.
 */

import type { Language } from "@/lib/types";
import { getTwilioProvider } from "./twilio-provider";

export interface SmsInput {
  to: string;
  studentName: string;
  date: string;
  absenceStatus: string;
  language: Language;
  parentName: string;
}

export interface SmsResult {
  ok: boolean;
  messageId: string;
  provider: string;
  timestamp: string;
  status: "sent" | "failed" | "queued";
  note: string;
}

/**
 * SMS Provider Interface - abstracted for future WhatsApp/other integrations
 */
export interface SmsProvider {
  send(input: SmsInput): Promise<SmsResult>;
}

/**
 * Twilio SMS Adapter for the generic SmsProvider interface
 */
export const twilioSmsAdapter: SmsProvider = {
  async send(input: SmsInput): Promise<SmsResult> {
    const twilioProvider = getTwilioProvider();

    // Build SMS message based on language
    const messageBody = buildSmsMessage(input);

    const result = await twilioProvider.send({
      to: input.to,
      body: messageBody,
      studentName: input.studentName,
      parentName: input.parentName,
      language: input.language,
    });

    return {
      ok: result.ok,
      messageId: result.messageId,
      provider: result.provider,
      timestamp: result.timestamp,
      status: result.status === "queued" ? "queued" : result.status === "sent" ? "sent" : "failed",
      note: result.errorMessage || `SMS sent via ${result.provider}. Log ID: ${result.logId}`,
    };
  },
};

/**
 * Build localized SMS message based on language
 * Keeps messages concise for SMS (160 characters or less is ideal)
 */
function buildSmsMessage(input: SmsInput): string {
  const { parentName, studentName, date, absenceStatus } = input;

  const messages: Record<Language, string> = {
    English: `Dear ${parentName}, ${studentName} was marked ${absenceStatus} on ${date}. Please confirm with school. -AttendAI`,
    Telugu: `${parentName} గారూ, ${studentName} ${date}న ${absenceStatus}గా గుర్తించబడారు. దయచేసి పాఠశాలకు సందేశం పంపండి. -AttendAI`,
    Hindi: `प्रिय ${parentName}, ${studentName} को ${date} को ${absenceStatus} के रूप में चिह्नित किया गया। कृपया स्कूल से संपर्क करें। -AttendAI`,
    Tamil: `${parentName}, ${studentName} ${date}ல் ${absenceStatus}ஆக குறிப்பிடப்பட்டுள்ளது. தயவுசெய்து பள்ளியைத் தொடர்புகொள்ளுங்கள். -AttendAI`,
    Kannada: `${parentName}, ${studentName} ${date}ರಂದು ${absenceStatus}ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಶಾಲೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ. -AttendAI`,
    Urdu: `${parentName}، ${studentName} کو ${date} کو ${absenceStatus} کے طور پر نشان زد کیا گیا۔ براہ کرم سکول سے رابطہ کریں۔ -AttendAI`,
  };

  return messages[input.language] || messages["English"];
}

/**
 * Gets the appropriate SMS provider based on configuration
 */
export function getSmsProvider(): SmsProvider {
  return twilioSmsAdapter;
}

export const smsService = {
  async send(input: SmsInput): Promise<SmsResult> {
    const provider = getSmsProvider();
    return provider.send(input);
  },
};
