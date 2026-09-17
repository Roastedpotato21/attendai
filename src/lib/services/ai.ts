import type {
  AnalyticsDashboardData,
  StudentRiskProfile,
  ClassAIInsight,
  StudentAIInsight,
  AIActionRecommendation,
} from "@/lib/types";

export interface AIAnalysisService {
  generateClassInsights(data: AnalyticsDashboardData): Promise<ClassAIInsight[]>;
  generateStudentInsights(profile: StudentRiskProfile): Promise<StudentAIInsight>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockAiAnalysisService: AIAnalysisService = {
  async generateClassInsights(data) {
    await delay(600); // Simulate AI generation delay

    const insights: ClassAIInsight[] = [];

    if (data.atRiskStudents.length > 5) {
      insights.push({
        id: `ai-class-1`,
        type: "trend",
        title: "Widespread Attendance Drop Detected",
        description: `There are currently ${data.atRiskStudents.length} students classified as at-risk. This is higher than the historical average.`,
        impact: "high",
      });
    }

    const lowClasses = data.classWiseAttendance.filter((c) => c.percentage < 80);
    if (lowClasses.length > 0) {
      const names = lowClasses.map((c) => c.className).join(", ");
      insights.push({
        id: `ai-class-2`,
        type: "anomaly",
        title: "Critical Class Averages",
        description: `The following classes are underperforming the 80% baseline: ${names}.`,
        impact: "high",
      });
    } else if (data.classWiseAttendance.length > 0) {
      insights.push({
        id: `ai-class-3`,
        type: "summary",
        title: "Healthy Attendance Baseline",
        description:
          "All tracked classes are currently maintaining healthy attendance rates above 80%.",
        impact: "low",
      });
    }

    // Identify consecutive patterns across the dataset
    const highConsecutive = data.atRiskStudents.filter((s) => s.consecutiveAbsences >= 3);
    if (highConsecutive.length > 0) {
      insights.push({
        id: `ai-class-4`,
        type: "anomaly",
        title: "Consecutive Absences Spike",
        description: `${highConsecutive.length} students have missed 3 or more consecutive days recently. Check for systemic issues like flu outbreaks.`,
        impact: "medium",
      });
    }

    return insights;
  },

  async generateStudentInsights(profile) {
    await delay(800); // Simulate AI generation delay

    let riskExplanation = "";
    const unusualPatterns: string[] = [];
    const recommendedActions: AIActionRecommendation[] = [];

    // Explanation logic
    if (profile.riskLevel === "high") {
      riskExplanation = `Student is classified as High Risk primarily due to ${
        profile.consecutiveAbsences >= 3
          ? "an ongoing streak of consecutive absences"
          : "a critically low overall attendance percentage"
      }. Immediate intervention is advised.`;
    } else if (profile.riskLevel === "medium") {
      riskExplanation = `Student is at Medium Risk because their attendance (${profile.attendancePercentage}%) has dropped below the healthy threshold of 85%.`;
    } else {
      riskExplanation = "Student maintains a healthy attendance record.";
    }

    // Pattern logic
    if (profile.consecutiveAbsences >= 2) {
      unusualPatterns.push(`Missed the last ${profile.consecutiveAbsences} consecutive sessions.`);
    }
    if (profile.attendancePercentage < 75) {
      unusualPatterns.push(
        "Historical attendance rate has dropped significantly below class median.",
      );
    }
    if (unusualPatterns.length === 0) {
      unusualPatterns.push("No highly unusual patterns detected at this time.");
    }

    // Action generation logic
    if (profile.riskLevel === "high") {
      recommendedActions.push({
        action: "Trigger Automated Parent Call (L1 Intervention)",
        type: "intervention",
      });
      recommendedActions.push({
        action: "Schedule 1:1 with School Counselor",
        type: "meeting",
      });
    } else if (profile.riskLevel === "medium") {
      recommendedActions.push({
        action: "Send SMS Warning to Parent",
        type: "communication",
      });
      if (profile.consecutiveAbsences >= 2) {
        recommendedActions.push({
          action: "Check in with student during next homeroom",
          type: "meeting",
        });
      }
    } else {
      recommendedActions.push({
        action: "Acknowledge good attendance",
        type: "communication",
      });
    }

    return {
      summary: `AI Profile Analysis for ${profile.name}`,
      riskExplanation,
      unusualPatterns,
      recommendedActions,
    };
  },
};

import { generateClassInsightsServerFn, generateStudentInsightsServerFn } from "./ai-provider";

export const aiAnalysisService: AIAnalysisService = {
  async generateClassInsights(data) {
    return generateClassInsightsServerFn({ data });
  },
  async generateStudentInsights(profile) {
    return generateStudentInsightsServerFn({ data: profile });
  },
};
