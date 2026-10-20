/**
 * Voice call data-access service.
 */

import { isSimulatedCommunication } from "./record-metrics";
import type { CallRecord } from "@/lib/types";
import type { PlaceCallInput, ProviderResult } from "@/lib/services/communication";
import { communication } from "@/lib/services/communication";
import { communicationRepository, studentRepository, parentRepository } from "../db/repositories";

export interface VoiceCallService {
  getAll(): Promise<CallRecord[]>;
  retry(id: string): Promise<ProviderResult>;
}

export const voiceCallService: VoiceCallService = {
  async getAll() {
    const comms = await communicationRepository.findAll();
    const voiceComms = comms.filter((c) => c.type === "voice");

    const records: CallRecord[] = [];
    for (const c of voiceComms) {
      const student = await studentRepository.findById(c.studentId);
      const parent = await parentRepository.findById(c.parentId);

      if (student && parent) {
        records.push({
          id: c.id,
          studentId: student.id,
          student: student.name,
          parent: parent.name,
          language: parent.language,
          startedAt: c.createdAt,
          durationSec: c.durationSec || 0,
          attempts: c.attempts || 0,
          status: isSimulatedCommunication(c)
            ? "simulated"
            : c.callStatus === "completed" && !c.providerMessageId
              ? "unconfirmed"
              : c.callStatus || "unconfirmed",
          sentiment: c.sentiment || "unknown",
          parentResponse: c.parentResponse || "",
          aiSummary: c.aiSummary || "",
        });
      }
    }
    return records;
  },
  async retry(id) {
    return communication.voice.retry(id);
  },
};
