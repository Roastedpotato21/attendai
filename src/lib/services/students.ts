/**
 * Student data-access service.
 *
 * Directs all reads to the hardened studentRepository.
 * In Supabase mode, queries Supabase and throws typed database errors.
 * In explicit mock mode, uses memoryDb.
 */

import type { KPIs, Student } from "@/lib/types";
import { studentRepository } from "../db/repositories";

export interface StudentService {
  getAll(): Promise<Student[]>;
  getById(id: string): Promise<Student | undefined>;
  getAbsentToday(): Promise<Student[]>;
  getKPIs(): Promise<KPIs>;
}

export const studentService: StudentService = {
  async getAll(): Promise<Student[]> {
    const populated = await studentRepository.findAll();
    return populated.map((s) => ({
      id: s.id,
      name: s.name,
      roll: s.roll,
      className: s.class.name,
      section: s.class.section,
      parentName: s.parent.name,
      parentPhone: s.parent.phone,
      language: s.parent.language,
      attendanceRate: s.attendanceRate,
      consecutiveAbsences: s.consecutiveAbsences,
      status: s.status,
      risk: s.risk,
    }));
  },

  async getById(id: string): Promise<Student | undefined> {
    const s = await studentRepository.findById(id);
    if (!s) return undefined;
    return {
      id: s.id,
      name: s.name,
      roll: s.roll,
      className: s.class.name,
      section: s.class.section,
      parentName: s.parent.name,
      parentPhone: s.parent.phone,
      language: s.parent.language,
      attendanceRate: s.attendanceRate,
      consecutiveAbsences: s.consecutiveAbsences,
      status: s.status,
      risk: s.risk,
    };
  },

  async getAbsentToday(): Promise<Student[]> {
    const all = await this.getAll();
    return all.filter((s) => s.status === "absent");
  },

  async getKPIs(): Promise<KPIs> {
    const all = await this.getAll();
    const total = all.length;
    const absent = all.filter((s) => s.status === "absent").length;
    const present = total - absent;
    const attendanceToday = total > 0 ? Math.round((present / total) * 100) : 100;

    return {
      attendanceToday,
      absentToday: absent,
      callsToday: 18,
      callSuccess: 94,
      messagesSent: 42,
      openEscalations: 3,
      parentsReached: 38,
      avgResponseMin: 4.2,
    };
  },
};
