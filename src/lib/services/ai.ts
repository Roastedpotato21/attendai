import type {
  AnalyticsDashboardData,
  StudentRiskProfile,
  ClassAIInsight,
  StudentAIInsight,
} from "@/lib/types";
export interface AIAnalysisService {
  generateClassInsights(data: AnalyticsDashboardData): Promise<ClassAIInsight[]>;
  generateStudentInsights(profile: StudentRiskProfile): Promise<StudentAIInsight>;
}
import { generateClassInsightsServerFn, generateStudentInsightsServerFn } from "./ai-provider";

export const aiAnalysisService: AIAnalysisService = {
  async generateClassInsights(data) {
    return generateClassInsightsServerFn({ data });
  },
  async generateStudentInsights(profile) {
    return generateStudentInsightsServerFn({ data: profile });
  },
};
