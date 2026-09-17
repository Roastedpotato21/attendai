/**
 * Voice call data-access service.
 */

import type { CallRecord } from "@/lib/types";
import type { PlaceCallInput, ProviderResult } from "@/lib/services/communication";
import { communication } from "@/lib/services/communication";
import { communicationRepository, studentRepository, parentRepository } from "../db/repositories";

export interface VoiceCallService {
  getAll(): Promise<CallRecord[]>;
  retry(id: string): Promise<ProviderResult>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockVoiceCallService: VoiceCallService = {
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
          status: c.callStatus || "failed",
          sentiment: c.sentiment || "unreachable",
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

export const voiceCallService: VoiceCallService = mockVoiceCallService;
