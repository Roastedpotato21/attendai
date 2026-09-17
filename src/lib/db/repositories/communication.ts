import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbCommunication } from "../schema";
import { fromSupabaseError } from "../errors";

export const communicationRepository = {
  async create(
    record: Omit<DbCommunication, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbCommunication> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("communications")
        .insert({
          student_id: record.studentId,
          parent_id: record.parentId,
          type: record.type,

          duration_sec: record.durationSec,
          attempts: record.attempts,
          call_status: record.callStatus,
          sentiment: record.sentiment,
          parent_response: record.parentResponse,
          ai_summary: record.aiSummary,

          message_status: record.messageStatus,
          template_id: record.templateId,
          body: record.body,

          provider_message_id: record.providerMessageId,
          sms_status: record.smsStatus,
          parent_phone: record.parentPhone,
          provider_name: record.providerName,

          error_details: record.errorDetails,
        })
        .select()
        .single();

      if (error) throw fromSupabaseError("communication create", error);
      if (!data) throw fromSupabaseError("communication create");

      return {
        id: data.id,
        institutionId: data.institution_id,
        studentId: data.student_id,
        parentId: data.parent_id,
        type: data.type as DbCommunication["type"],

        durationSec: data.duration_sec,
        attempts: data.attempts,
        callStatus: data.call_status as Exclude<DbCommunication["callStatus"], undefined>,
        sentiment: data.sentiment as Exclude<DbCommunication["sentiment"], undefined>,
        parentResponse: data.parent_response,
        aiSummary: data.ai_summary,

        messageStatus: data.message_status as Exclude<DbCommunication["messageStatus"], undefined>,
        templateId: data.template_id,
        body: data.body,

        providerMessageId: data.provider_message_id,
        smsStatus: data.sms_status as Exclude<DbCommunication["smsStatus"], undefined>,
        parentPhone: data.parent_phone,
        providerName: data.provider_name,

        errorDetails: data.error_details,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const newRecord: DbCommunication = {
      ...record,
      id: `comm-${Date.now()}-${Math.random()}`,
      institutionId:
        memoryDb.students.find((item) => item.id === record.studentId)?.institutionId ??
        "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memoryDb.communications.push(newRecord);
    return newRecord;
  },

  async update(id: string, updates: Partial<DbCommunication>): Promise<void> {
    if (hasDatabaseConnection() && supabase) {
      const updateData: Record<string, unknown> = {};

      if (updates.durationSec !== undefined) updateData["duration_sec"] = updates.durationSec;
      if (updates.attempts !== undefined) updateData["attempts"] = updates.attempts;
      if (updates.callStatus !== undefined) updateData["call_status"] = updates.callStatus;
      if (updates.sentiment !== undefined) updateData["sentiment"] = updates.sentiment;
      if (updates.parentResponse !== undefined)
        updateData["parent_response"] = updates.parentResponse;
      if (updates.aiSummary !== undefined) updateData["ai_summary"] = updates.aiSummary;

      if (updates.messageStatus !== undefined) updateData["message_status"] = updates.messageStatus;
      if (updates.body !== undefined) updateData["body"] = updates.body;

      if (updates.providerMessageId !== undefined)
        updateData["provider_message_id"] = updates.providerMessageId;
      if (updates.smsStatus !== undefined) updateData["sms_status"] = updates.smsStatus;
      if (updates.parentPhone !== undefined) updateData["parent_phone"] = updates.parentPhone;
      if (updates.providerName !== undefined) updateData["provider_name"] = updates.providerName;

      if (updates.errorDetails !== undefined) updateData["error_details"] = updates.errorDetails;

      const { error } = await supabase.from("communications").update(updateData).eq("id", id);

      if (error) throw fromSupabaseError("communication update", error);
      return;
    }

    const idx = memoryDb.communications.findIndex((c) => c.id === id);
    if (idx !== -1) {
      memoryDb.communications[idx] = {
        ...memoryDb.communications[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      } as DbCommunication;
    }
  },

  async findAll(): Promise<DbCommunication[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("communications")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw fromSupabaseError("communication list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        institutionId: d.institution_id,
        studentId: d.student_id,
        parentId: d.parent_id,
        type: d.type as DbCommunication["type"],

        durationSec: d.duration_sec,
        attempts: d.attempts,
        callStatus: d.call_status as Exclude<DbCommunication["callStatus"], undefined>,
        sentiment: d.sentiment as Exclude<DbCommunication["sentiment"], undefined>,
        parentResponse: d.parent_response,
        aiSummary: d.ai_summary,

        messageStatus: d.message_status as Exclude<DbCommunication["messageStatus"], undefined>,
        templateId: d.template_id,
        body: d.body,

        providerMessageId: d.provider_message_id,
        smsStatus: d.sms_status as Exclude<DbCommunication["smsStatus"], undefined>,
        parentPhone: d.parent_phone,
        providerName: d.provider_name,

        errorDetails: d.error_details,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    return [...memoryDb.communications].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },
};
