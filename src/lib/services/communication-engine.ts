import {
  studentRepository,
  parentRepository,
  communicationRepository,
  attendanceRepository,
  smsRepository,
} from "../db/repositories";
import { communication as communicationProviders } from "./communication";
import { smsService } from "./sms";
import type { DbParent } from "../db/schema";
import type { PopulatedStudent } from "../db/repositories/student";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Provider error";

export interface CommunicationEngine {
  triggerAbsenceNotifications(sessionId: string, absentStudentIds: string[]): void;
  _processAbsences(sessionId: string, absentStudentIds: string[]): Promise<void>;

  triggerInterventionOutreach(studentId: string, riskLevel: string): void;
  _processInterventionOutreach(studentId: string, riskLevel: string): Promise<void>;

  _sendSmsNotification(
    parent: DbParent,
    student: PopulatedStudent,
    recordId: string,
    date: string,
  ): Promise<void>;
  _sendVoiceNotification(
    parent: DbParent,
    student: PopulatedStudent,
    recordId: string,
  ): Promise<void>;
  _sendWhatsAppNotification(
    parent: DbParent,
    student: PopulatedStudent,
    recordId: string,
    date: string,
  ): Promise<void>;
}

export const communicationEngine: CommunicationEngine = {
  triggerAbsenceNotifications(sessionId: string, absentStudentIds: string[]) {
    // Fire and forget - do not await to avoid blocking UI
    this._processAbsences(sessionId, absentStudentIds).catch((err: unknown) => {
      console.error("[CommunicationEngine] Error processing absences:", err);
    });
  },

  triggerInterventionOutreach(studentId: string, riskLevel: string) {
    this._processInterventionOutreach(studentId, riskLevel).catch((err: unknown) => {
      console.error("[CommunicationEngine] Error processing intervention outreach:", err);
    });
  },

  async _processInterventionOutreach(studentId: string, riskLevel: string) {
    if (riskLevel !== "high") return;

    try {
      const student = await studentRepository.findById(studentId);
      if (!student) return;

      const parent = await parentRepository.findById(student.parentId);
      if (!parent) return;

      const channel = parent.preferredChannel || "sms";

      // 1. Create pending communication record
      const record = await communicationRepository.create({
        studentId: student.id,
        parentId: parent.id,
        type: channel,

        callStatus: channel === "voice" ? "scheduled" : null,
        attempts: channel === "voice" ? 0 : null,
        messageStatus: channel === "sms" || channel === "whatsapp" ? "sent" : null,
        body: `Dear ${parent.name}, ${student.name}'s attendance has dropped critically low. Please contact the school immediately.`,
      });

      // 2. Dispatch to provider
      if (channel === "voice") {
        try {
          await communicationProviders.voice.call({
            to: parent.phone,
            language: parent.language,
            scriptTemplateId: "T-06",
            variables: {
              parent_name: parent.name,
              school_name: "AttendAI",
              student_name: student.name,
            },
          });

          await communicationRepository.update(record.id, {
            callStatus: "completed",
            attempts: 1,
            durationSec: 30,
            sentiment: "concerned",
            parentResponse: "Received automated intervention call.",
            aiSummary: "Parent notified of critical attendance risk.",
          });
        } catch (error: unknown) {
          await communicationRepository.update(record.id, {
            callStatus: "failed",
            attempts: 1,
            errorDetails: getErrorMessage(error),
          });
        }
      } else {
        // SMS or WhatsApp
        try {
          await communicationProviders.messaging.send({
            to: parent.phone,
            channel: channel === "whatsapp" ? "WhatsApp" : "SMS",
            language: parent.language,
            templateId: "T-01",
            variables: {
              parent_name: parent.name,
              student_name: student.name,
              date: new Date().toISOString().split("T")[0] as string,
            },
          });

          await communicationRepository.update(record.id, {
            messageStatus: "delivered",
          });
        } catch (error: unknown) {
          await communicationRepository.update(record.id, {
            messageStatus: "failed",
            errorDetails: getErrorMessage(error),
          });
        }
      }
    } catch (e) {
      console.error(
        `[CommunicationEngine] Failed to process intervention outreach for student ${studentId}`,
        e,
      );
    }
  },

  async _processAbsences(sessionId: string, absentStudentIds: string[]) {
    const session = await attendanceRepository.findSessionById(sessionId);
    if (!session) return;

    for (const studentId of absentStudentIds) {
      try {
        const student = await studentRepository.findById(studentId);
        if (!student) continue;

        const parent = await parentRepository.findById(student.parentId);
        if (!parent) continue;

        const channel = parent.preferredChannel || "sms";

        // 1. Check for duplicate SMS (prevent sending multiple times same day)
        const alreadySentToday = await smsRepository.hasSmsToday(studentId, session.date);
        if (alreadySentToday) {
          console.log(
            `[CommunicationEngine] SMS already sent to ${studentId} today, skipping duplicate.`,
          );
          continue;
        }

        // 2. Create pending communication record
        const record = await communicationRepository.create({
          studentId: student.id,
          parentId: parent.id,
          type: channel,

          // If voice
          callStatus: channel === "voice" ? "scheduled" : null,
          attempts: channel === "voice" ? 0 : null,

          // If message
          messageStatus: channel === "sms" || channel === "whatsapp" ? "sent" : null,
          body: `Dear ${parent.name}, ${student.name} was marked absent today (${session.date}). Please confirm the reason.`,

          // SMS specific
          parentPhone: parent.phone,
          smsStatus: channel === "sms" ? "sent" : null,
        });

        // 3. Dispatch to provider (fire and forget to not block attendance submission)
        if (channel === "voice") {
          this._sendVoiceNotification(parent, student, record.id).catch((e) =>
            console.error("[CommunicationEngine] Voice notification error:", e),
          );
        } else if (channel === "sms") {
          // Send SMS asynchronously (non-blocking)
          this._sendSmsNotification(parent, student, record.id, session.date).catch((e) =>
            console.error("[CommunicationEngine] SMS notification error:", e),
          );
        } else {
          // WhatsApp
          this._sendWhatsAppNotification(parent, student, record.id, session.date).catch((e) =>
            console.error("[CommunicationEngine] WhatsApp notification error:", e),
          );
        }
      } catch (e) {
        console.error(`[CommunicationEngine] Failed to process student ${studentId}`, e);
      }
    }
  },

  /**
   * Send SMS notification (non-blocking)
   * Failures are logged but don't fail attendance submission
   */
  async _sendSmsNotification(
    parent: DbParent,
    student: PopulatedStudent,
    recordId: string,
    date: string,
  ): Promise<void> {
    try {
      const result = await smsService.send({
        to: parent.phone,
        studentName: student.name,
        date: date,
        absenceStatus: "absent",
        language: parent.language,
        parentName: parent.name,
      });

      // Update communication record with SMS result
      await communicationRepository.update(recordId, {
        smsStatus: result.ok ? "sent" : "failed",
        providerMessageId: result.messageId,
        providerName: result.provider,
        errorDetails: result.ok ? null : result.note,
        messageStatus: result.ok ? "sent" : "failed",
      });

      if (result.ok) {
        console.log(
          `[SMS] Successfully sent absence notification to ${parent.name} (${parent.phone}) for ${student.name}`,
        );
      } else {
        console.warn(`[SMS] Failed to send absence notification: ${result.note}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SMS] Exception while sending SMS: ${errorMessage}`);

      // Mark as failed in database, but don't throw (non-blocking)
      try {
        await communicationRepository.update(recordId, {
          smsStatus: "failed",
          errorDetails: errorMessage,
          messageStatus: "failed",
        });
      } catch (updateError) {
        console.error("[SMS] Failed to update communication record:", updateError);
      }
    }
  },

  /**
   * Send voice notification (existing logic)
   */
  async _sendVoiceNotification(
    parent: DbParent,
    student: PopulatedStudent,
    recordId: string,
  ): Promise<void> {
    try {
      await communicationProviders.voice.call({
        to: parent.phone,
        language: parent.language,
        scriptTemplateId: "T-06",
        variables: {
          parent_name: parent.name,
          school_name: "AttendAI",
          student_name: student.name,
        },
      });

      await communicationRepository.update(recordId, {
        callStatus: "completed",
        attempts: 1,
        durationSec: 45,
        sentiment: "neutral",
        parentResponse: "Received via automated call.",
        aiSummary: "Parent notified of absence.",
      });
    } catch (error: unknown) {
      await communicationRepository.update(recordId, {
        callStatus: "failed",
        attempts: 1,
        errorDetails: getErrorMessage(error),
      });
    }
  },

  /**
   * Send WhatsApp notification
   */
  async _sendWhatsAppNotification(
    parent: DbParent,
    student: PopulatedStudent,
    recordId: string,
    date: string,
  ): Promise<void> {
    try {
      await communicationProviders.messaging.send({
        to: parent.phone,
        channel: "WhatsApp",
        language: parent.language,
        templateId: "T-01",
        variables: {
          parent_name: parent.name,
          student_name: student.name,
          date: date,
        },
      });

      await communicationRepository.update(recordId, {
        messageStatus: "delivered",
      });
    } catch (error: unknown) {
      await communicationRepository.update(recordId, {
        messageStatus: "failed",
        errorDetails: getErrorMessage(error),
      });
    }
  },
};
