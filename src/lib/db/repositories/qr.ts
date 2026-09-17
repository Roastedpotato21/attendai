import { hasDatabaseConnection, supabase } from "../connection";
import type { DbQRSession, DbQRCheckIn } from "../schema";
import { createServerFn } from "@tanstack/react-start";
import { serverStore } from "../server-store";
import { fromSupabaseError } from "../errors";

// ---------------------------------------------------------------------------
// Server-side mock store (used only when hasDatabaseConnection() is false)
// ---------------------------------------------------------------------------

const createSessionServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as Omit<DbQRSession, "id" | "institutionId" | "createdAt" | "updatedAt">,
  )
  .handler(async ({ data: session }) => {
    console.log("[QR SERVER] createSession called");
    const newSession: DbQRSession = {
      ...session,
      id: `qr-${Date.now()}`,
      institutionId: "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    serverStore.qrSessions.push(newSession);
    console.log("[QR SERVER] created session ID:", newSession.id);
    return newSession;
  });

const findSessionByIdServerFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: id }) => {
    console.log("[QR SERVER] findSession called with ID:", id);
    console.log(
      "[QR SERVER] available session IDs:",
      serverStore.qrSessions.map((s) => s.id).join(", "),
    );
    const found = serverStore.qrSessions.find((s) => s.id === id) || null;
    console.log("[QR SERVER] found session:", !!found);
    return found;
  });

const updateSessionServerFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; updates: Partial<DbQRSession> }) => d)
  .handler(async ({ data: { id, updates } }) => {
    const idx = serverStore.qrSessions.findIndex((s) => s.id === id);
    if (idx !== -1) {
      serverStore.qrSessions[idx] = {
        ...serverStore.qrSessions[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      } as DbQRSession;
    }
  });

const createCheckInServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: unknown) =>
      data as Omit<DbQRCheckIn, "id" | "institutionId" | "createdAt" | "updatedAt">,
  )
  .handler(async ({ data: checkIn }) => {
    const newCheckIn: DbQRCheckIn = {
      ...checkIn,
      id: `checkin-${Date.now()}`,
      institutionId: "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    serverStore.qrCheckIns.push(newCheckIn);
    return newCheckIn;
  });

const findCheckInsBySessionServerFn = createServerFn({ method: "GET" })
  .validator((d: string) => d)
  .handler(async ({ data: sessionId }) => {
    return serverStore.qrCheckIns.filter((c) => c.sessionId === sessionId);
  });

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const qrRepository = {
  async createSession(
    session: Omit<DbQRSession, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbQRSession> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    // Mock mode only — use server store
    return await createSessionServerFn({ data: session });
  },

  async findSessionById(id: string): Promise<DbQRSession | null> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    // Mock mode only
    return await findSessionByIdServerFn({ data: id });
  },

  async updateSession(id: string, updates: Partial<DbQRSession>): Promise<void> {
    if (hasDatabaseConnection() && supabase) {
      const updateData: Record<string, unknown> = {};
      if (updates.active !== undefined) updateData["active"] = updates.active;
      if (updates.expiresAt !== undefined) updateData["expires_at"] = updates.expiresAt;

      const { error } = await supabase.from("qr_sessions").update(updateData).eq("id", id);

      if (error) throw fromSupabaseError("QR session update", error);
      return;
    }

    // Mock mode only
    await updateSessionServerFn({ data: { id, updates } });
  },

  async createCheckIn(
    checkIn: Omit<DbQRCheckIn, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbQRCheckIn> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    // Mock mode only
    return await createCheckInServerFn({ data: checkIn });
  },

  async findCheckInsBySession(sessionId: string): Promise<DbQRCheckIn[]> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    // Mock mode only
    return await findCheckInsBySessionServerFn({ data: sessionId });
  },
};
