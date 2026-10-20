import type { AIInsight, Integration, RolesMatrixRow } from "@/lib/types";

export interface InsightsService {
  getAll(): Promise<AIInsight[]>;
}
export interface IntegrationsService {
  getAll(): Promise<Integration[]>;
}
export interface RolesService {
  getMatrix(): Promise<RolesMatrixRow[]>;
}

// These modules have no persisted data source yet. Never substitute demo records.
export const insightsService = {
  async getAll(): Promise<AIInsight[]> {
    return [];
  },
};
export const integrationsService = {
  async getAll(): Promise<Integration[]> {
    return [];
  },
};
export const rolesService = {
  async getMatrix(): Promise<RolesMatrixRow[]> {
    return [];
  },
};
