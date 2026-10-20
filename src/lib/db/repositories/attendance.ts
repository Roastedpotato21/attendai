import { readAllRows } from "../pagination";
import { supabase } from "../connection";
import type { DbAttendanceSession, DbAttendanceRecord } from "../schema";
import { fromSupabaseError } from "../errors";

export const attendanceRepository = {
  async findSessionByClassDate(classId: string, date: string): Promise<DbAttendanceSession | null> {
    const { data, error } = await supabase
      .from("attendance_sessions")
      .select("id")
      .eq("class_id", classId)
      .eq("date", date)
      .maybeSingle();
    if (error) throw fromSupabaseError("daily attendance lookup", error);
    return data ? this.findSessionById(data.id) : null;
  },
  async createSession(
    session: Omit<DbAttendanceSession, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbAttendanceSession> {
    const { data, error } = await supabase
      .from("attendance_sessions")
      .insert({
        class_id: session.classId,
        date: session.date,
        method: session.method,
        total_present: session.totalPresent,
        total_absent: session.totalAbsent,
        total_late: session.totalLate,
      })
      .select()
      .single();

    if (error) throw fromSupabaseError("attendance session create", error);
    if (!data) throw fromSupabaseError("attendance session create");

    return {
      id: data.id,
      revision: data.revision,
      modifiedBy: data.modified_by,
      institutionId: data.institution_id,
      classId: data.class_id,
      date: data.date,
      method: data.method as DbAttendanceSession["method"],
      totalPresent: data.total_present,
      totalAbsent: data.total_absent,
      totalLate: data.total_late,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async createRecords(
    records: Omit<DbAttendanceRecord, "id" | "institutionId" | "createdAt" | "updatedAt">[],
  ): Promise<DbAttendanceRecord[]> {
    const { data, error } = await supabase
      .from("attendance_records")
      .insert(
        records.map((r) => ({
          session_id: r.sessionId,
          student_id: r.studentId,
          status: r.status,
        })),
      )
      .select();

    if (error) throw fromSupabaseError("attendance records create", error);
    if (!data) throw fromSupabaseError("attendance records create");

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      sessionId: d.session_id,
      studentId: d.student_id,
      status: d.status as DbAttendanceRecord["status"],
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  /**
   * Atomic attendance submission via PostgreSQL RPC (when available).
   *
   * Requires the RPC in Supabase mode so partial submissions cannot survive.
   */
  async submitAttendance(
    classId: string,
    date: string,
    method: DbAttendanceSession["method"],
    records: Array<{ studentId: string; status: DbAttendanceRecord["status"] }>,
  ): Promise<{
    session: DbAttendanceSession;
    records: DbAttendanceRecord[];
  }> {
    // Try atomic RPC first
    const rpcPayload = {
      p_class_id: classId,
      p_date: date,
      p_method: method,
      p_records: records.map((r) => ({ student_id: r.studentId, status: r.status })),
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc("submit_attendance", rpcPayload);

    if (rpcError) {
      if (rpcError.code === "42883" || rpcError.code === "PGRST202") {
        throw new Error(
          "Attendance setup is incomplete. Apply the submit_attendance database migration.",
        );
      }
      if (rpcError.code === "23505") {
        throw new Error("Attendance has already been submitted for this class and date.");
      }
      throw fromSupabaseError("attendance submit", rpcError);
    }

    // Parse RPC result
    const result = typeof rpcData === "string" ? JSON.parse(rpcData) : rpcData;
    const sessionId = result.session_id as string;

    // Fetch the created session and records
    const session = await this.findSessionById(sessionId);
    if (!session) throw fromSupabaseError("attendance submit: session not found after RPC");
    // Keep the version/counts of this write if another editor commits before
    // the readback. Reading a later revision would hide a concurrent edit.
    session.revision = result.revision ?? 0;
    session.totalPresent = result.total_present;
    session.totalAbsent = result.total_absent;
    session.totalLate = result.total_late;
    const createdRecords = await this.findRecordsBySessionId(sessionId);

    return { session, records: createdRecords };
  },

  async updateAttendance(
    sessionId: string,
    expectedRevision: number,
    records: Array<{ studentId: string; status: DbAttendanceRecord["status"] }>,
  ): Promise<{ session: DbAttendanceSession; records: DbAttendanceRecord[] }> {
    const { data, error } = await supabase.rpc("update_attendance", {
      p_session_id: sessionId,
      p_expected_revision: expectedRevision,
      p_records: records.map((r) => ({ student_id: r.studentId, status: r.status })),
    });
    if (error?.code === "PT409") {
      throw new Error(
        "Attendance was changed by another staff member. Reload the register before saving.",
      );
    }
    if (error?.code === "42883" || error?.code === "PGRST202") {
      throw new Error("Attendance editing needs the attendance corrections database migration.");
    }
    if (error) throw fromSupabaseError("attendance update", error);
    const session = await this.findSessionById(sessionId);
    if (!session) throw fromSupabaseError("updated attendance session lookup");
    session.revision = data.revision;
    session.totalPresent = data.total_present;
    session.totalAbsent = data.total_absent;
    session.totalLate = data.total_late;
    return { session, records: await this.findRecordsBySessionId(sessionId) };
  },

  async findSessionById(id: string): Promise<DbAttendanceSession | null> {
    const { data, error } = await supabase
      .from("attendance_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw fromSupabaseError("attendance session lookup", error);
    if (!data) return null;

    return {
      id: data.id,
      revision: data.revision,
      modifiedBy: data.modified_by,
      institutionId: data.institution_id,
      classId: data.class_id,
      date: data.date,
      method: data.method as DbAttendanceSession["method"],
      totalPresent: data.total_present,
      totalAbsent: data.total_absent,
      totalLate: data.total_late,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async findRecordsByStudentId(studentId: string): Promise<DbAttendanceRecord[]> {
    const data = await readAllRows(
      (from, to) =>
        supabase
          .from("attendance_records")
          .select("*")
          .eq("student_id", studentId)
          .order("id")
          .range(from, to),
      "attendance findRecordsByStudentId",
    );

    if (!data) return [];

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      sessionId: d.session_id,
      studentId: d.student_id,
      status: d.status as DbAttendanceRecord["status"],
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  async findRecordsBySessionId(sessionId: string): Promise<DbAttendanceRecord[]> {
    const data = await readAllRows(
      (from, to) =>
        supabase
          .from("attendance_records")
          .select("*")
          .eq("session_id", sessionId)
          .order("id")
          .range(from, to),
      "attendance findRecordsBySessionId",
    );

    if (!data) return [];

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      sessionId: d.session_id,
      studentId: d.student_id,
      status: d.status as DbAttendanceRecord["status"],
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  async findAllSessions(): Promise<DbAttendanceSession[]> {
    const data = await readAllRows(
      (from, to) => supabase.from("attendance_sessions").select("*").order("id").range(from, to),
      "attendance findAllSessions",
    );

    if (!data) return [];

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      classId: d.class_id,
      date: d.date,
      method: d.method as DbAttendanceSession["method"],
      totalPresent: d.total_present,
      totalAbsent: d.total_absent,
      totalLate: d.total_late,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  async findAllRecords(): Promise<DbAttendanceRecord[]> {
    const data = await readAllRows(
      (from, to) => supabase.from("attendance_records").select("*").order("id").range(from, to),
      "attendance findAllRecords",
    );

    if (!data) return [];

    return data.map((d) => ({
      id: d.id,
      institutionId: d.institution_id,
      sessionId: d.session_id,
      studentId: d.student_id,
      status: d.status as DbAttendanceRecord["status"],
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },
};
