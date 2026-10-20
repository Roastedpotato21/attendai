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

async function unavailable(): Promise<ProviderResult> {
  throw new Error(
    "Manual outreach is unavailable. Attendance notifications use the server communication worker.",
  );
}
export const communication = {
  messaging: { send: unavailable } as MessagingProvider,
  voice: { call: unavailable, retry: unavailable } as VoiceProvider,
  ai: {
    async summarize(): Promise<string> {
      throw new Error("Call summarization is unavailable.");
    },
  } as SummarizationProvider,
};
