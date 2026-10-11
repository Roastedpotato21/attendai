/**
 * Message data-access service.
 */

import type { MessageRecord } from "@/lib/types";
import { communicationRepository, studentRepository, parentRepository } from "../db/repositories";

export interface MessageService {
  getAll(): Promise<MessageRecord[]>;
}

export const messageService: MessageService = {
  async getAll() {
    const comms = await communicationRepository.findAll();
    const messageComms = comms.filter(
      (c) => c.type === "sms" || c.type === "whatsapp" || c.type === "push",
    );

    const records = await Promise.all(
      messageComms.map(async (c): Promise<MessageRecord | null> => {
        const student = await studentRepository.findById(c.studentId);
        const parent = await parentRepository.findById(c.parentId);

        if (student && parent) {
          return {
            id: c.id,
            channel: c.type === "whatsapp" ? "WhatsApp" : c.type === "push" ? "Push" : "SMS",
            student: student.name,
            parentPhone: c.type === "push" ? "Guardian device" : c.parentPhone || parent.phone,
            language: parent.language,
            template: c.templateId || "Absence alert",
            sentAt: c.processedAt || c.createdAt,
            status: c.messageStatus || "queued",
            body: c.body || "",
          };
        }
        return null;
      }),
    );
    return records.filter((record): record is MessageRecord => record !== null);
  },
};
