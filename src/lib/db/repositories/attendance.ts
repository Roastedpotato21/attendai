import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbAttendanceSession, DbAttendanceRecord } from "../schema";
import { fromSupabaseError } from "../errors";

export const attendanceRepository = {
  async findSessionByClassDate(classId: string, date: string): Promise<DbAttendanceSession | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("attendance_sessions")
        .select("id")
        .eq("class_id", classId)
        .eq("date", date)
        .maybeSingle();
      if (error) throw fromSupabaseError("daily attendance lookup", error);
      return data ? this.findSessionById(data.id) : null;
    }
    return (
      memoryDb.attendanceSessions.find((s) => s.classId === classId && s.date === date) ?? null
    );
  },
  async createSession(
    session: Omit<DbAttendanceSession, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbAttendanceSession> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    const newSession: DbAttendanceSession = {
      ...session,
      revision: 0,
      id: `session-${Date.now()}`,
      institutionId:
        memoryDb.classes.find((item) => item.id === session.classId)?.institutionId ??
        "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryDb.attendanceSessions.push(newSession);
    return newSession;
  },

  async createRecords(
    records: Omit<DbAttendanceRecord, "id" | "institutionId" | "createdAt" | "updatedAt">[],
  ): Promise<DbAttendanceRecord[]> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    const newRecords = records.map((r, i) => ({
      ...r,
      id: `record-${Date.now()}-${i}`,
      institutionId:
        memoryDb.attendanceSessions.find((item) => item.id === r.sessionId)?.institutionId ??
        "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    memoryDb.attendanceRecords.push(...newRecords);
    return newRecords;
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
    if (hasDatabaseConnection() && supabase) {
      // Try atomic RPC first
      const rpcPayload = {
        p_class_id: classId,
        p_date: date,
        p_method: method,
        p_records: records.map((r) => ({ student_id: r.studentId, status: r.status })),
      };

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "submit_attendance",
        rpcPayload,
      );

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
    }

    // Mock mode: sequential writes
    const session = await this.createSession({
      classId,
      date,
      method,
      totalPresent: records.filter((r) => r.status === "present").length,
      totalAbsent: records.filter((r) => r.status === "absent").length,
      totalLate: records.filter((r) => r.status === "late").length,
    });
    const recs = await this.createRecords(
      records.map((r) => ({ sessionId: session.id, studentId: r.studentId, status: r.status })),
    );
    return { session, records: recs };
  },

  async updateAttendance(
    sessionId: string,
    expectedRevision: number,
    records: Array<{ studentId: string; status: DbAttendanceRecord["status"] }>,
  ): Promise<{ session: DbAttendanceSession; records: DbAttendanceRecord[] }> {
    if (hasDatabaseConnection() && supabase) {
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
    }
    const session = memoryDb.attendanceSessions.find((s) => s.id === sessionId);
    if (!session) throw new Error("Attendance session not found.");
    if ((session.revision ?? 0) !== expectedRevision) {
      throw new Error(
        "Attendance was changed by another staff member. Reload the register before saving.",
      );
    }
    for (const record of records) {
      const existing = memoryDb.attendanceRecords.find(
        (r) => r.sessionId === sessionId && r.studentId === record.studentId,
      );
      if (!existing) throw new Error("Attendance record not found.");
    }
    for (const record of records) {
      const existing = memoryDb.attendanceRecords.find(
        (r) => r.sessionId === sessionId && r.studentId === record.studentId,
      )!;
      existing.status = record.status;
      existing.updatedAt = new Date().toISOString();
    }
    const saved = await this.findRecordsBySessionId(sessionId);
    session.totalPresent = saved.filter((r) => r.status === "present").length;
    session.totalAbsent = saved.filter((r) => r.status === "absent").length;
    session.totalLate = saved.filter((r) => r.status === "late").length;
    session.revision = expectedRevision + 1;
    session.updatedAt = new Date().toISOString();
    return { session, records: saved };
  },

  async findSessionById(id: string): Promise<DbAttendanceSession | null> {
    if (hasDatabaseConnection() && supabase) {
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
    }

    return memoryDb.attendanceSessions.find((s) => s.id === id) || null;
  },

  async findRecordsByStudentId(studentId: string): Promise<DbAttendanceRecord[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("student_id", studentId);

      if (error) throw fromSupabaseError("student attendance list", error);
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
    }

    return memoryDb.attendanceRecords.filter((r) => r.studentId === studentId);
  },

  async findRecordsBySessionId(sessionId: string): Promise<DbAttendanceRecord[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("session_id", sessionId);

      if (error) throw fromSupabaseError("session records list", error);
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
    }

    return memoryDb.attendanceRecords.filter((r) => r.sessionId === sessionId);
  },

  async findAllSessions(): Promise<DbAttendanceSession[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("attendance_sessions").select("*");

      if (error) throw fromSupabaseError("attendance session list", error);
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
    }

    return [...memoryDb.attendanceSessions];
  },

  async findAllRecords(): Promise<DbAttendanceRecord[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("attendance_records").select("*");

      if (error) throw fromSupabaseError("attendance record list", error);
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
    }

    return [...memoryDb.attendanceRecords];
  },
};
