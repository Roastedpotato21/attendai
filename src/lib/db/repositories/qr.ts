import { supabase } from "../connection";
import type { DbQRSession, DbQRCheckIn } from "../schema";
import { fromSupabaseError } from "../errors";

export const qrRepository = {
  async createSession(
    session: Omit<DbQRSession, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbQRSession> {
    const { data, error } = await supabase
      .from("qr_sessions")
      .insert({
        class_id: session.classId,
        faculty_id: session.facultyId,
        date: session.date,
        expires_at: session.expiresAt,
        active: session.active,
      })
      .select()
      .single();

    if (error) throw fromSupabaseError("QR session create", error);
    if (!data) throw fromSupabaseError("QR session create");

    return {
      id: data.id,
      institutionId: data.institution_id,
      classId: data.class_id,
      facultyId: data.faculty_id,
      date: data.date,
      expiresAt: data.expires_at,
      active: data.active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async findSessionById(id: string): Promise<DbQRSession | null> {
    const { data, error } = await supabase
      .from("qr_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw fromSupabaseError("QR session lookup", error);
    if (!data) return null;

    return {
      id: data.id,
      institutionId: data.institution_id,
      classId: data.class_id,
      facultyId: data.faculty_id,
      date: data.date,
      expiresAt: data.expires_at,
      active: data.active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async updateSession(id: string, updates: Partial<DbQRSession>): Promise<void> {
    const updateData: Record<string, unknown> = {};
    if (updates.active !== undefined) updateData["active"] = updates.active;
    if (updates.expiresAt !== undefined) updateData["expires_at"] = updates.expiresAt;

    const { error } = await supabase.from("qr_sessions").update(updateData).eq("id", id);

    if (error) throw fromSupabaseError("QR session update", error);
    return;
  },

  async createCheckIn(
    checkIn: Omit<DbQRCheckIn, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbQRCheckIn> {
    const { data, error } = await supabase
      .from("qr_check_ins")
      .insert({
        session_id: checkIn.sessionId,
        student_id: checkIn.studentId,
        timestamp: checkIn.timestamp,
        status: checkIn.status,
      })
      .select()
      .single();

    if (error) throw fromSupabaseError("QR check-in create", error);
    if (!data) throw fromSupabaseError("QR check-in create");

    return {
      id: data.id,
      institutionId: data.institution_id,
      sessionId: data.session_id,
      studentId: data.student_id,
      timestamp: data.timestamp,
      status: data.status as DbQRCheckIn["status"],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async findCheckInsBySession(sessionId: string): Promise<DbQRCheckIn[]> {
    const { data, error } = await supabase
      .from("qr_check_ins")
      .select("*")
      .eq("session_id", sessionId);

    if (error) throw fromSupabaseError("QR check-in list", error);
    if (!data) return [];

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      sessionId: d.session_id,
      studentId: d.student_id,
      timestamp: d.timestamp,
      status: d.status as DbQRCheckIn["status"],
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },
};
