/**
 * Student data-access service.
 *
 * Directs all reads to the hardened studentRepository.
 * In Supabase mode, queries Supabase and throws typed database errors.
 */

import type { KPIs, Student } from "@/lib/types";
import { format } from "date-fns";
import {
  acceptedMessage,
  isSimulatedCommunication,
  attendancePercentage,
  recordsForDate,
  todayDate,
  studentHistoryMetrics,
} from "./record-metrics";
import {
  studentRepository,
  attendanceRepository,
  communicationRepository,
  escalationRepository,
} from "../db/repositories";

export interface StudentService {
  getAll(): Promise<Student[]>;
  getById(id: string): Promise<Student | undefined>;
  getAbsentToday(): Promise<Student[]>;
  getKPIs(): Promise<KPIs>;
}

export const studentService: StudentService = {
  async getAll(): Promise<Student[]> {
    const [populated, sessions, records] = await Promise.all([
      studentRepository.findAll(),
      attendanceRepository.findAllSessions(),
      attendanceRepository.findAllRecords(),
    ]);
    const todayRecords = recordsForDate(sessions, records, todayDate());
    const statusByStudent = new Map(
      todayRecords.map((record) => [record.studentId, record.status]),
    );
    return populated.map((s) => ({
      id: s.id,
      name: s.name,
      roll: s.roll,
      className: s.class.name,
      section: s.class.section,
      parentName: s.parent.name,
      parentPhone: s.parent.phone,
      language: s.parent.language,
      ...studentHistoryMetrics(s.id, sessions, records),
      status: statusByStudent.get(s.id) ?? "unmarked",
    }));
  },

  async getById(id: string): Promise<Student | undefined> {
    return (await this.getAll()).find((student) => student.id === id);
  },

  async getAbsentToday(): Promise<Student[]> {
    return (await this.getAll()).filter((student) => student.status === "absent");
  },

  async getKPIs(): Promise<KPIs> {
    const [sessions, records, communications, escalations] = await Promise.all([
      attendanceRepository.findAllSessions(),
      attendanceRepository.findAllRecords(),
      communicationRepository.findAll(),
      escalationRepository.findAll(),
    ]);
    const today = todayDate();
    const marked = recordsForDate(sessions, records, today);
    const todayCommunications = communications.filter(
      (record) =>
        !isSimulatedCommunication(record) &&
        format(new Date(record.processedAt ?? record.createdAt), "yyyy-MM-dd") === today,
    );
    const calls = todayCommunications.filter((record) => record.type === "voice");
    const messages = todayCommunications.filter(acceptedMessage);
    return {
      attendanceToday: attendancePercentage(marked),
      absentToday: new Set(
        marked.filter((record) => record.status === "absent").map((record) => record.studentId),
      ).size,
      callsToday: calls.length,
      callSuccess: calls.length
        ? Math.round(
            (calls.filter((record) => record.callStatus === "completed" && record.providerMessageId)
              .length /
              calls.length) *
              100,
          )
        : null,
      messagesSent: messages.length,
      openEscalations: escalations.filter((record) => record.status !== "resolved").length,
      parentsReached: new Set(messages.map((record) => record.parentId)).size,
      avgResponseMin: null,
    };
  },
};
