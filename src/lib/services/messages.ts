/**
 * Message data-access service.
 */

import type { MessageRecord } from "@/lib/types";
import type { ProviderResult, SendMessageInput } from "@/lib/services/communication";
import { communication } from "@/lib/services/communication";
import { communicationRepository, studentRepository, parentRepository } from "../db/repositories";

export interface MessageService {
  getAll(): Promise<MessageRecord[]>;
  send(input: SendMessageInput): Promise<ProviderResult>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockMessageService: MessageService = {
  async getAll() {
    const comms = await communicationRepository.findAll();
    const messageComms = comms.filter((c) => c.type === "sms" || c.type === "whatsapp");

    const records: MessageRecord[] = [];
    for (const c of messageComms) {
      const student = await studentRepository.findById(c.studentId);
      const parent = await parentRepository.findById(c.parentId);

      if (student && parent) {
        records.push({
          id: c.id,
          channel: c.type === "whatsapp" ? "WhatsApp" : "SMS",
          student: student.name,
          parentPhone: parent.phone,
          language: parent.language,
          template: c.templateId || "Custom",
          sentAt: c.createdAt,
          status: c.messageStatus || "failed",
          body: c.body || "",
        });
      }
    }
    return records;
  },
  async send(input) {
    return communication.messaging.send(input);
  },
};

export const messageService: MessageService = mockMessageService;
