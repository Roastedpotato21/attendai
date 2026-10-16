/** Trusted server-only SMS contract. Acceptance never implies delivery. */
export type SmsDelivery = (
  | {
      ok: true;
      provider: string;
      providerId: string;
      status: "queued" | "sent" | "failed" | "undelivered";
      httpStatus?: number;
      body?: string;
      templateId?: string;
      recipient?: string;
    }
  | {
      ok: false;
      errorClass: "transient" | "permanent" | "ambiguous";
      message: string;
      httpStatus?: number;
      providerCode?: string;
    }
) & {
  safeResponseBody?: string;
  diagnostics?: { stage: string; elapsedMs: number; error?: string; contentType?: string | null };
};

export interface SmsProvider {
  readonly name: string;
  validate(recipient: string): string | null;
  send(input: { recipient: string; body: string; communicationId: string }): Promise<SmsDelivery>;
}

/** Historical Twilio adapters/callbacks remain available; SMS is retired. */
export class TwilioProvider implements SmsProvider {
  readonly name = "twilio";
  validate() {
    return "Twilio is disabled for new SMS";
  }
  async send(): Promise<SmsDelivery> {
    return { ok: false, errorClass: "permanent", message: this.validate() };
  }
}
