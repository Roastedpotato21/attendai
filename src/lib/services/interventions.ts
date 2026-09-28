import type { Intervention, InterventionStatus, RiskLevel } from "@/lib/types";
import { interventionRepository, studentRepository } from "../db/repositories";
import { analyticsService } from "./analytics";

type InterventionWithClassId = Intervention & { classId?: string };

export interface InterventionService {
  getInterventions(filters?: {
    status?: string;
    classId?: string;
    riskLevel?: string;
  }): Promise<Intervention[]>;
  updateStatus(id: string, status: InterventionStatus): Promise<void>;
  runInterventionEngine(): Promise<{ created: number; notified: number }>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockInterventionService: InterventionService = {
  async getInterventions(filters = {}) {
    await delay(300);
    const dbInterventions = await interventionRepository.findAll();
    const students = await studentRepository.findAll();

    let interventions: InterventionWithClassId[] = dbInterventions.map((i) => {
      const student = students.find((s) => s.id === i.studentId);
      return {
        id: i.id,
        studentId: i.studentId,
        studentName: student?.name || "Unknown Student",
        className: student?.class.fullName || "Unknown Class",
        riskLevel: i.riskLevel,
        reason: i.reason,
        status: i.status,
        actionTaken: i.actionTaken || undefined,
        actionDate: i.actionDate || undefined,
        ownerId: i.ownerId || undefined,
        createdAt: i.createdAt,
        classId: student?.class.id,
      } as InterventionWithClassId;
    });

    if (filters.status && filters.status !== "all") {
      interventions = interventions.filter((i) => i.status === filters.status);
    }
    if (filters.classId && filters.classId !== "all") {
      interventions = interventions.filter((i) => i.classId === filters.classId);
    }
    if (filters.riskLevel && filters.riskLevel !== "all") {
      interventions = interventions.filter((i) => i.riskLevel === filters.riskLevel);
    }

    // Sort by created descending
    interventions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return interventions;
  },

  async updateStatus(id: string, status: InterventionStatus) {
    await delay(200);
    const updates: { status: InterventionStatus; actionTaken?: string; actionDate?: string } = {
      status,
    };
    if (status === "resolved") {
      updates.actionTaken = "Issue marked as resolved manually.";
      updates.actionDate = new Date().toISOString();
    }
    await interventionRepository.update(id, updates);
  },

  async runInterventionEngine() {
    await delay(500);
    const analytics = await analyticsService.getDashboardData();
    const existingInterventions = await interventionRepository.findAll();

    let createdCount = 0;
    let notifiedCount = 0;

    for (const riskProfile of analytics.atRiskStudents) {
      if (riskProfile.riskLevel === "low") continue; // Low risk students usually don't trigger automated interventions

      // Check if there's an active intervention for this student
      const hasActive = existingInterventions.some(
        (i) =>
          i.studentId === riskProfile.studentId &&
          (i.status === "pending" || i.status === "in-progress"),
      );

      if (!hasActive) {
        // Create new intervention
        const reason =
          riskProfile.consecutiveAbsences >= 3
            ? `Consecutive absences (${riskProfile.consecutiveAbsences})`
            : `Low attendance (${riskProfile.attendancePercentage}%)`;

        await interventionRepository.create({
          studentId: riskProfile.studentId,
          riskLevel: riskProfile.riskLevel,
          reason: reason,
          status: "pending",
        });

        createdCount++;

        // Phase 3B does not dispatch providers from this UI process. Absence
        // alerts are enqueued atomically by the database outbox trigger;
        // intervention outreach remains an explicit operational workflow.
        if (riskProfile.riskLevel === "high") {
          notifiedCount += 0;
        }
      }
    }

    return { created: createdCount, notified: notifiedCount };
  },
};

export const interventionService: InterventionService = mockInterventionService;
