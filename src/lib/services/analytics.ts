import type {
  AnalyticsDashboardData,
  ClassAttendanceStat,
  StudentRiskProfile,
  RiskLevel,
} from "@/lib/types";
import { attendanceRepository, classRepository, studentRepository } from "../db/repositories";
import type { DbAttendanceRecord } from "../db/schema";

export interface AnalyticsService {
  getDashboardData(filters?: {
    classId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<AnalyticsDashboardData>;
}

export const analyticsService: AnalyticsService = {
  async getDashboardData(filters = {}) {
    const allSessions = await attendanceRepository.findAllSessions();
    const allRecords = await attendanceRepository.findAllRecords();
    const allClasses = await classRepository.findAll();
    const allStudents = await studentRepository.findAll();

    // Filter sessions
    const filteredSessions = allSessions.filter((session) => {
      let keep = true;
      if (filters.classId && filters.classId !== "all" && session.classId !== filters.classId)
        keep = false;
      if (filters.startDate && new Date(session.date) < new Date(filters.startDate)) keep = false;
      if (filters.endDate && new Date(session.date) > new Date(filters.endDate)) keep = false;
      return keep;
    });

    const filteredSessionIds = new Set(filteredSessions.map((s) => s.id));
    const filteredRecords = allRecords.filter((r) => filteredSessionIds.has(r.sessionId));

    // Calculate Class-wise attendance
    const classWiseMap = new Map<string, { present: number; total: number }>();
    for (const record of filteredRecords) {
      const session = filteredSessions.find((s) => s.id === record.sessionId);
      if (!session) continue;

      const classId = session.classId;
      if (!classWiseMap.has(classId)) {
        classWiseMap.set(classId, { present: 0, total: 0 });
      }

      const stats = classWiseMap.get(classId)!;
      stats.total++;
      if (record.status === "present" || record.status === "late") {
        stats.present++;
      }
    }

    const classWiseAttendance: ClassAttendanceStat[] = [];
    for (const [classId, stats] of classWiseMap.entries()) {
      const cls = allClasses.find((c) => c.id === classId);
      classWiseAttendance.push({
        classId,
        className: cls ? cls.fullName : "Unknown Class",
        percentage: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0,
      });
    }

    // Sort descending by percentage
    classWiseAttendance.sort((a, b) => b.percentage - a.percentage);

    // Calculate Student-wise attendance and consecutive absences
    const studentRecordsMap = new Map<string, Array<DbAttendanceRecord & { date: string }>>();
    for (const record of filteredRecords) {
      if (!studentRecordsMap.has(record.studentId)) {
        studentRecordsMap.set(record.studentId, []);
      }
      const session = filteredSessions.find((s) => s.id === record.sessionId);
      if (session) {
        studentRecordsMap.get(record.studentId)!.push({ ...record, date: session.date });
      }
    }

    const atRiskStudents: StudentRiskProfile[] = [];
    for (const [studentId, records] of studentRecordsMap.entries()) {
      const student = allStudents.find((s) => s.id === studentId);
      if (!student) continue;

      let presentCount = 0;
      for (const record of records) {
        if (record.status === "present" || record.status === "late") {
          presentCount++;
        }
      }

      const percentage =
        records.length > 0 ? Math.round((presentCount / records.length) * 100) : 100;

      // Calculate consecutive absences
      // Sort records by date ascending
      records.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let consecutiveAbsences = 0;
      for (let i = records.length - 1; i >= 0; i--) {
        const record = records[i];
        if (!record) continue;
        if (record.status === "absent") {
          consecutiveAbsences++;
        } else if (record.status === "present" || record.status === "late") {
          break; // Streak broken
        }
      }

      // Assign risk level
      let riskLevel: RiskLevel = "low";
      if (percentage < 75) {
        riskLevel = "high";
      } else if (percentage < 85) {
        riskLevel = "medium";
      }

      if (percentage < 75 || consecutiveAbsences >= 3) {
        atRiskStudents.push({
          studentId,
          name: student.name,
          className: student.class.fullName,
          attendancePercentage: percentage,
          consecutiveAbsences,
          riskLevel: riskLevel,
        });
      }
    }

    // Sort at-risk students by lowest percentage first
    atRiskStudents.sort((a, b) => a.attendancePercentage - b.attendancePercentage);

    return {
      classWiseAttendance,
      atRiskStudents,
    };
  },
};
