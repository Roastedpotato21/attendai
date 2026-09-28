import type {
  DbUser,
  DbClass,
  DbParent,
  DbStudent,
  DbFaculty,
  DbClassFaculty,
  DbAttendanceSession,
  DbAttendanceRecord,
  DbQRSession,
  DbQRCheckIn,
  DbCommunication,
  DbEscalation,
  DbAuditLog,
  DbIntervention,
  DatabaseFacultyRole,
} from "./schema";

import {
  students as MOCK_STUDENTS,
  calls as MOCK_CALLS,
  messages as MOCK_MESSAGES,
  escalations as MOCK_ESCALATIONS,
  faculty as MOCK_FACULTY,
  auditLogs as MOCK_AUDIT_LOGS,
} from "../mock-data";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FacultyRole } from "../types";
import { ConfigurationError, ConnectionError } from "./errors";

// ---------------------------------------------------------------------------
// Data mode
// ---------------------------------------------------------------------------

/**
 * Explicit data mode.
 *
 * - `"supabase"` — all persistence uses the Supabase client.  Missing config
 *    or connection failures are surfaced as errors; the app NEVER silently
 *    falls back to in-memory data.
 * - `"mock"` — uses InMemoryDatabase for development / demo purposes.
 */
export type DataMode = "supabase" | "mock";

const databaseFacultyRoles: Record<FacultyRole, DatabaseFacultyRole> = {
  Admin: "professor",
  "Class Teacher": "assistant_professor",
  Faculty: "lecturer",
  HOD: "hod",
};

const MOCK_INSTITUTION_ID = "mock-institution";

// ---------------------------------------------------------------------------
// Resolve data mode
// ---------------------------------------------------------------------------

const readEnv = (key: string): string | undefined =>
  typeof import.meta !== "undefined" && import.meta.env ? import.meta.env[key] : undefined;

const supabaseUrl = readEnv("VITE_SUPABASE_URL");
const supabaseKey = readEnv("VITE_SUPABASE_ANON_KEY");
const dataModeRaw = readEnv("VITE_DATA_MODE");

/**
 * Determine the active data mode.
 *
 * - Explicit `VITE_DATA_MODE=supabase` → supabase mode (missing creds throw)
 * - Explicit `VITE_DATA_MODE=mock` → mock mode
 * - Not set but Supabase URL/key present → supabase mode
 * - Not set and no Supabase vars → mock mode
 */
function resolveDataMode(): DataMode {
  if (dataModeRaw === "mock") return "mock";
  return "supabase";
}

const resolvedMode = resolveDataMode();

// Fail early in supabase mode if credentials are missing
if (resolvedMode === "supabase" && (!supabaseUrl || !supabaseKey)) {
  throw new ConfigurationError(
    "connection",
    "Supabase persistence is enabled (VITE_DATA_MODE=supabase) but VITE_SUPABASE_URL " +
      "and VITE_SUPABASE_ANON_KEY are not both configured. " +
      "Set VITE_DATA_MODE=mock for development without Supabase.",
  );
}

/** Returns the resolved data mode. */
export function getDataMode(): DataMode {
  return resolvedMode;
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

export const supabase: SupabaseClient | null =
  resolvedMode === "supabase" && supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true },
      })
    : null;

/** Returns true when the app should use Supabase for persistence. */
export const hasDatabaseConnection = (): boolean =>
  resolvedMode === "supabase" && supabase !== null;

/**
 * Returns the Supabase client or throws.
 *
 * Use this in repository code paths that MUST talk to Supabase (i.e. when
 * `hasDatabaseConnection()` is true but a narrowing guard is needed for TS).
 * In mock mode this will throw a `ConnectionError` — the caller should have
 * already checked `hasDatabaseConnection()`.
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new ConfigurationError(
      "requireSupabase",
      "Supabase client is not available. Ensure VITE_DATA_MODE=supabase and credentials are configured.",
    );
  }
  return supabase;
}

// ---------------------------------------------------------------------------
// In-memory fallback database (mock/demo mode only)
// ---------------------------------------------------------------------------

/**
 * In-memory fallback database.
 * This simulates a relational database by storing arrays of normalized objects.
 */
class InMemoryDatabase {
  users: DbUser[] = [];
  classes: DbClass[] = [];
  parents: DbParent[] = [];
  students: DbStudent[] = [];
  faculty: DbFaculty[] = [];
  classFaculty: DbClassFaculty[] = [];

  attendanceSessions: DbAttendanceSession[] = [];
  attendanceRecords: DbAttendanceRecord[] = [];

  qrSessions: DbQRSession[] = [];
  qrCheckIns: DbQRCheckIn[] = [];

  communications: DbCommunication[] = [];
  escalations: DbEscalation[] = [];
  interventions: DbIntervention[] = [];
  auditLogs: DbAuditLog[] = [];

  constructor() {
    this.seed();
  }

  private seed() {
    console.log("Seeding in-memory database with mock data...");

    // 1. Seed Users (from auth.ts mock)
    this.users = [
      {
        id: "u-admin",
        name: "System Admin",
        email: "admin@attendai.com",
        role: "admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "u-faculty",
        name: "Dr. Sarah Jenkins",
        email: "s.jenkins@attendai.com",
        role: "faculty",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "u-staff",
        name: "Front Desk Staff",
        email: "staff@attendai.com",
        role: "staff",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "u-student-1",
        name: "John Doe",
        email: "john.doe@student.edu",
        role: "student",
        studentId: "1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "u-student-2",
        name: "Jane Smith",
        email: "jane.smith@student.edu",
        role: "student",
        studentId: "2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // 2. Seed Classes
    const uniqueClasses = Array.from(new Set(MOCK_STUDENTS.map((s) => s.className)));
    uniqueClasses.forEach((className, idx) => {
      this.classes.push({
        id: `class-${idx + 1}`,
        institutionId: MOCK_INSTITUTION_ID,
        name: className,
        section: "A",
        fullName: `${className} - A`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    // 3. Seed Students and Parents
    MOCK_STUDENTS.forEach((s) => {
      const parentId = `parent-${s.id}`;
      const classId = this.classes.find((c) => c.name === s.className)?.id || "class-1";

      this.parents.push({
        id: parentId,
        institutionId: MOCK_INSTITUTION_ID,
        name: s.parentName,
        phone: s.parentPhone,
        language: s.language,
        preferredChannel: s.language === "Telugu" ? "voice" : "sms", // Just a simple mock default
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      this.students.push({
        id: s.id,
        institutionId: MOCK_INSTITUTION_ID,
        parentId,
        classId,
        name: s.name,
        roll: s.roll,
        attendanceRate: s.attendanceRate,
        consecutiveAbsences: s.consecutiveAbsences,
        status: s.status === "unmarked" ? "absent" : s.status,
        risk: s.risk,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    // 4. Seed Communications (Voice calls + Messages)
    MOCK_CALLS.forEach((c) => {
      const student = this.students.find((s) => s.name === c.student);
      if (!student) return;
      this.communications.push({
        id: c.id,
        institutionId: MOCK_INSTITUTION_ID,
        studentId: student.id,
        parentId: student.parentId,
        type: "voice",
        durationSec: c.durationSec,
        attempts: c.attempts,
        callStatus: c.status,
        sentiment: c.sentiment,
        parentResponse: c.parentResponse,
        aiSummary: c.aiSummary,
        createdAt: c.startedAt,
        updatedAt: c.startedAt,
      });
    });

    MOCK_MESSAGES.forEach((m) => {
      const student = this.students.find((s) => s.name === m.student);
      if (!student) return;
      this.communications.push({
        id: m.id,
        institutionId: MOCK_INSTITUTION_ID,
        studentId: student.id,
        parentId: student.parentId,
        type: m.channel.toLowerCase() as "sms" | "whatsapp",
        messageStatus: m.status,
        body: m.body,
        createdAt: m.sentAt,
        updatedAt: m.sentAt,
      });
    });

    // 5. Seed Escalations
    MOCK_ESCALATIONS.forEach((e) => {
      const student = this.students.find((s) => s.name === e.student);
      const cls = this.classes.find((c) => c.fullName === e.className);
      if (!student || !cls) return;

      this.escalations.push({
        id: e.id,
        institutionId: MOCK_INSTITUTION_ID,
        studentId: student.id,
        classId: cls.id,
        reason: e.reason,
        level: e.level,
        status: e.status,
        ownerId: "u-faculty",
        createdAt: e.raisedAt,
        updatedAt: e.raisedAt,
      });
    });

    // 6. Seed Faculty
    MOCK_FACULTY.forEach((f) => {
      this.faculty.push({
        id: f.id,
        institutionId: MOCK_INSTITUTION_ID,
        userId: "u-faculty", // Mock link
        department: f.department,
        role: databaseFacultyRoles[f.role]!,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      // Mock class assignments
      f.classes.forEach((cName) => {
        const cls = this.classes.find((c) => c.fullName === cName);
        if (cls) {
          this.classFaculty.push({
            id: `${f.id}-${cls.id}`,
            institutionId: MOCK_INSTITUTION_ID,
            facultyId: f.id,
            classId: cls.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      });
    });

    // 7. Seed Audit Logs
    MOCK_AUDIT_LOGS.forEach((a) => {
      this.auditLogs.push({
        id: a.id,
        institutionId: MOCK_INSTITUTION_ID,
        actorId: "u-admin", // Mock link
        action: a.action,
        target: a.target,
        ip: a.ip,
        severity: a.severity,
        createdAt: a.at,
        updatedAt: a.at,
      });
    });
  }
}

// Global instance for the in-memory mock DB
export const memoryDb = new InMemoryDatabase();
