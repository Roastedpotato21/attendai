/**
 * Attendance data-access service.
 *
 * All operations go through the hardened attendanceRepository and classRepository.
 * Supabase submissions require the atomic submit_attendance RPC.
 */

import type {
  AttendanceTrend,
  ClassAttendance,
  LanguageSplit,
  AttendanceSubmission,
  AttendanceSubmissionResult,
  StudentDashboardData,
  Student,
} from "@/lib/types";
import type { DbAttendanceRecord, DbAttendanceSession, DbClass } from "../db/schema";
import { attendanceRepository, classRepository, studentRepository } from "../db/repositories";
import { format, subDays } from "date-fns";
import {
  attendancePercentage,
  isSimulatedCommunication,
  todayDate,
  studentHistoryMetrics,
} from "./record-metrics";
import { communicationRepository } from "../db/repositories";
import { NotFoundError, ValidationError } from "../db/errors";

export interface AttendanceService {
  getClasses(): Promise<DbClass[]>;
  getRegister(
    classId: string,
    date: string,
  ): Promise<{
    students: Student[];
    session: DbAttendanceSession | null;
    records: DbAttendanceRecord[];
  }>;
  getTrend(): Promise<AttendanceTrend[]>;
  getClassAttendance(): Promise<ClassAttendance[]>;
  getLanguageSplit(): Promise<LanguageSplit[]>;
  submitAttendance(submission: AttendanceSubmission): Promise<AttendanceSubmissionResult>;
  getStudentDashboard(studentId: string): Promise<StudentDashboardData>;
}

export const attendanceService: AttendanceService = {
  getClasses() {
    return classRepository.findManageable();
  },

  async getRegister(classId, date) {
    const [roster, session, allSessions, history] = await Promise.all([
      studentRepository.findByClassId(classId),
      attendanceRepository.findSessionByClassDate(classId, date),
      attendanceRepository.findAllSessions(),
      attendanceRepository.findAllRecords(),
    ]);
    const records = session ? await attendanceRepository.findRecordsBySessionId(session.id) : [];
    return {
      session,
      records,
      students: roster.map((s) => ({
        id: s.id,
        name: s.name,
        roll: s.roll,
        className: s.class.fullName,
        section: s.class.section,
        parentName: s.parent?.name ?? null,
        parentPhone: s.parent?.phone ?? null,
        language: s.parent?.language ?? null,
        ...studentHistoryMetrics(s.id, allSessions, history),
        status: records.find((record) => record.studentId === s.id)?.status ?? "unmarked",
      })),
    };
  },
  async getTrend(): Promise<AttendanceTrend[]> {
    const [sessions, records, communications] = await Promise.all([
      attendanceRepository.findAllSessions(),
      attendanceRepository.findAllRecords(),
      communicationRepository.findAll(),
    ]);
    const cutoff = format(subDays(new Date(), 6), "yyyy-MM-dd");
    const dates = [...new Set(sessions.map((session) => session.date))]
      .filter((date) => date >= cutoff && date <= todayDate())
      .sort();
    return dates.flatMap((date) => {
      const ids = new Set(
        sessions.filter((session) => session.date === date).map((session) => session.id),
      );
      const percentage = attendancePercentage(
        records.filter((record) => ids.has(record.sessionId)),
      );
      if (percentage === null) return [];
      return [
        {
          day: date,
          present: percentage,
          absent: 100 - percentage,
          calls: communications.filter(
            (record) =>
              record.type === "voice" &&
              !isSimulatedCommunication(record) &&
              format(new Date(record.createdAt), "yyyy-MM-dd") === date,
          ).length,
        },
      ];
    });
  },

  async getClassAttendance(): Promise<ClassAttendance[]> {
    const [classes, sessions, records] = await Promise.all([
      classRepository.findAll(),
      attendanceRepository.findAllSessions(),
      attendanceRepository.findAllRecords(),
    ]);
    return classes.flatMap((cls) => {
      const ids = new Set(
        sessions.filter((session) => session.classId === cls.id).map((session) => session.id),
      );
      const marked = records.filter((record) => ids.has(record.sessionId));
      const rate = attendancePercentage(marked);
      return rate === null
        ? []
        : [
            {
              className: cls.fullName,
              rate,
              absent: marked.filter((record) => record.status === "absent").length,
            },
          ];
    });
  },

  async getLanguageSplit(): Promise<LanguageSplit[]> {
    const students = await studentRepository.findAll();
    const counts = new Map<string, number>();
    for (const student of students)
      if (student.parent)
        counts.set(student.parent.language, (counts.get(student.parent.language) ?? 0) + 1);
    return Array.from(counts, ([name, value]) => ({ name, value }));
  },

  async getStudentDashboard(studentId: string): Promise<StudentDashboardData> {
    const records = await attendanceRepository.findRecordsByStudentId(studentId);

    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;

    const history: Array<{
      id: string;
      date: string;
      status: "present" | "absent" | "late" | "excused" | "unmarked";
      className: string;
    }> = [];

    for (const record of records) {
      if (record.status === "present") presentCount++;
      else if (record.status === "absent") absentCount++;
      else if (record.status === "late") lateCount++;

      const session = await attendanceRepository.findSessionById(record.sessionId);
      if (session) {
        const cls = await classRepository.findById(session.classId);
        history.push({
          id: record.id,
          date: session.date,
          status: record.status,
          className: cls ? cls.fullName : "Unknown Class",
        });
      }
    }

    // Sort history by date descending
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const total = presentCount + absentCount + lateCount;
    const overallPercentage =
      total > 0 ? Math.round(((presentCount + lateCount) / total) * 100) : null;

    return {
      overallPercentage,
      presentCount,
      absentCount,
      lateCount,
      history,
    };
  },

  async submitAttendance(submission: AttendanceSubmission): Promise<AttendanceSubmissionResult> {
    const cls = submission.classId
      ? await classRepository.findById(submission.classId)
      : await classRepository.findByName(submission.className);
    if (!cls) {
      throw new NotFoundError("attendance submission", `Class "${submission.className}" not found`);
    }

    // Validate unmarked records
    for (const r of submission.records) {
      if (r.status === "unmarked") {
        throw new ValidationError(
          "attendance submission",
          `Student ${r.studentId} has not been marked.`,
        );
      }
    }

    // Map UI submission method ('faculty' | 'qr' | 'ai') to schema enum ('manual' | 'qr' | 'face')
    const dbMethod: DbAttendanceSession["method"] =
      submission.method === "faculty" ? "manual" : submission.method === "qr" ? "qr" : "face";

    // Atomically submit via repository
    const records = submission.records.map((r) => ({
      studentId: r.studentId,
      status: r.status as DbAttendanceRecord["status"],
    }));
    if (submission.sessionId && submission.expectedRevision === undefined) {
      throw new Error("Attendance editing needs the attendance corrections database migration.");
    }
    const { session } = submission.sessionId
      ? await attendanceRepository.updateAttendance(
          submission.sessionId,
          submission.expectedRevision!,
          records,
        )
      : await attendanceRepository.submitAttendance(cls.id, submission.date, dbMethod, records);

    // Phase 3B intentionally does not dispatch providers from this application
    // process. In Supabase mode, migration 00007 atomically creates consented
    // parent communication jobs with the attendance record. A server-side
    // worker claims those jobs later. Mock mode never attempts provider calls.

    return {
      success: true,
      sessionId: session.id,
      revision: session.revision,
      updated: !!submission.sessionId,
      message: submission.sessionId
        ? "Attendance updated successfully."
        : "Attendance submitted successfully.",
      totalPresent: session.totalPresent,
      totalAbsent: session.totalAbsent,
      totalLate: session.totalLate,
    };
  },
};
