/**
 * Communication service layer.
 *
 * These are provider-agnostic interfaces + a mock implementation so the UI is
 * fully functional today. Swapping in Twilio / WhatsApp Business API / MSG91
 * later only requires implementing these interfaces — no UI changes.
 */

import { SIMULATION_MODE } from "@/lib/config";
import type { Language } from "@/lib/types";

export type SendMessageInput = {
  to: string;
  channel: "SMS" | "WhatsApp";
  language: Language;
  templateId: string;
  variables: Record<string, string>;
};

export type PlaceCallInput = {
  to: string;
  language: Language;
  scriptTemplateId: string;
  variables: Record<string, string>;
  maxRetries?: number;
};

export type ProviderResult = {
  ok: boolean;
  id: string;
  provider: string;
  queuedAt: string;
  note: string;
};

export interface MessagingProvider {
  send(input: SendMessageInput): Promise<ProviderResult>;
}

export interface VoiceProvider {
  call(input: PlaceCallInput): Promise<ProviderResult>;
  retry(callId: string): Promise<ProviderResult>;
}

export interface SummarizationProvider {
  summarize(transcript: string, language: Language): Promise<string>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const mockMessagingProvider: MessagingProvider = {
  async send(input) {
    await delay(600);
    return {
      ok: true,
      id: rid("MSG"),
      provider: input.channel === "SMS" ? "msg91(mock)" : "whatsapp(mock)",
      queuedAt: new Date().toISOString(),
      note: "Queued in simulation mode — no real message was delivered.",
    };
  },
};

export const mockVoiceProvider: VoiceProvider = {
  async call(input) {
    await delay(800);
    return {
      ok: true,
      id: rid("CALL"),
      provider: "twilio(mock)",
      queuedAt: new Date().toISOString(),
      note: `Simulated AI voice call in ${input.language}.`,
    };
  },
  async retry(callId) {
    await delay(600);
    return {
      ok: true,
      id: callId,
      provider: "twilio(mock)",
      queuedAt: new Date().toISOString(),
      note: "Retry scheduled in simulation mode.",
    };
  },
};

export const mockSummarizationProvider: SummarizationProvider = {
  async summarize(transcript) {
    await delay(500);
    return `AI summary (simulated): ${transcript.slice(0, 90)}…`;
  },
};

export const communication = {
  messaging: mockMessagingProvider,
  voice: mockVoiceProvider,
  ai: mockSummarizationProvider,
  /** True while providers are mocked. Reads from centralized config. */
  get liveMode() {
    return !SIMULATION_MODE;
  },
};
