/**
 * Miscellaneous data-access services (Insights, Integrations, Roles).
 */

import type { AIInsight, Integration, RolesMatrixRow } from "@/lib/types";
import { aiInsights, integrations, rolesMatrix } from "@/lib/mock-data";

export interface InsightsService {
  getAll(): Promise<AIInsight[]>;
}

export interface IntegrationsService {
  getAll(): Promise<Integration[]>;
}

export interface RolesService {
  getMatrix(): Promise<RolesMatrixRow[]>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockInsightsService: InsightsService = {
  async getAll() {
    await delay(50);
    return aiInsights;
  },
};

export const mockIntegrationsService: IntegrationsService = {
  async getAll() {
    await delay(50);
    return integrations;
  },
};

export const mockRolesService: RolesService = {
  async getMatrix() {
    await delay(50);
    return rolesMatrix;
  },
};

export const insightsService: InsightsService = mockInsightsService;
export const integrationsService: IntegrationsService = mockIntegrationsService;
export const rolesService: RolesService = mockRolesService;
