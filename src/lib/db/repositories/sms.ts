/**
 * SMS Repository - Handles SMS-specific database operations
 *
 * Includes deduplication logic to prevent sending multiple SMS
 * for the same student on the same date.
 */

import { supabase } from "../connection";
import type { DbCommunication } from "../schema";
import { fromSupabaseError } from "../errors";

export const smsRepository = {
  /**
   * Check if SMS already sent for this student today
   * Prevents duplicate SMS notifications
   */
  async hasSmsToday(studentId: string, date: string): Promise<boolean> {
    const today = new Date(date).toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("communications")
      .select("id", { count: "exact" })
      .eq("student_id", studentId)
      .eq("type", "sms")
      .gte("created_at", `${today}T00:00:00Z`)
      .lte("created_at", `${today}T23:59:59Z`);

    if (error) throw fromSupabaseError("SMS duplicate lookup", error);
    if (!data) return false;
    return data.length > 0;
  },

  /**
   * Find SMS records for a student within date range
   * Useful for checking SMS delivery status and retries
   */
  async findSmsByStudent(
    studentId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DbCommunication[]> {
    let query = supabase
      .from("communications")
      .select("*")
      .eq("student_id", studentId)
      .eq("type", "sms")
      .order("created_at", { ascending: false });

    if (startDate) {
      query = query.gte("created_at", startDate);
    }
    if (endDate) {
      query = query.lte("created_at", endDate);
    }

    const { data, error } = await query;
    if (error) throw fromSupabaseError("student SMS list", error);
    if (!data) return [];

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      studentId: d.student_id,
      parentId: d.parent_id,
      type: d.type,
      messageStatus: d.message_status,
      smsStatus: d.sms_status,
      providerMessageId: d.provider_message_id,
      parentPhone: d.parent_phone,
      providerName: d.provider_name,
      body: d.body,
      errorDetails: d.error_details,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  /**
   * Get SMS by provider message ID (for webhook callbacks/delivery receipts)
   */
  async findByProviderMessageId(messageId: string): Promise<DbCommunication | null> {
    const { data, error } = await supabase
      .from("communications")
      .select("*")
      .eq("provider_message_id", messageId)
      .maybeSingle();

    if (error) throw fromSupabaseError("provider message lookup", error);
    if (!data) return null;

    return {
      id: data.id,
      institutionId: data.institution_id,
      studentId: data.student_id,
      parentId: data.parent_id,
      type: data.type,
      messageStatus: data.message_status,
      smsStatus: data.sms_status,
      providerMessageId: data.provider_message_id,
      parentPhone: data.parent_phone,
      providerName: data.provider_name,
      body: data.body,
      errorDetails: data.error_details,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  /**
   * Update SMS status (for delivery receipts, retries, etc.)
   */
  async updateSmsStatus(
    id: string,
    status: "sent" | "delivered" | "failed",
    providerDetails?: {
      messageId?: string;
      providerName?: string;
      errorDetails?: string;
    },
  ): Promise<void> {
    const updateData: Record<string, unknown> = { sms_status: status };

    if (providerDetails?.messageId) {
      updateData["provider_message_id"] = providerDetails.messageId;
    }
    if (providerDetails?.providerName) {
      updateData["provider_name"] = providerDetails.providerName;
    }
    if (providerDetails?.errorDetails) {
      updateData["error_details"] = providerDetails.errorDetails;
    }

    const { error } = await supabase.from("communications").update(updateData).eq("id", id);

    if (error) {
      throw fromSupabaseError("SMS status update", error);
    }
  },
};
