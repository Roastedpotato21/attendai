/**
 * Escalation data-access service.
 *
 * Directs all reads and updates to the hardened escalationRepository.
 * In Supabase mode, persists to Supabase and throws typed database errors.
 * In explicit mock mode, uses memoryDb.
 */

import type { Escalation } from "@/lib/types";
import { ESCALATION_LEVELS } from "@/lib/config";
import { escalationRepository } from "../db/repositories";
import { NotFoundError } from "../db/errors";

export interface EscalationService {
  getAll(): Promise<Escalation[]>;
  escalate(id: string): Promise<Escalation>;
  resolve(id: string): Promise<Escalation>;
}

export const escalationService: EscalationService = {
  async getAll() {
    return escalationRepository.findAll();
  },

  async escalate(id: string) {
    const item = await escalationRepository.findById(id);
    if (!item) {
      throw new NotFoundError("escalation", `Escalation ${id} not found`);
    }
    const idx = ESCALATION_LEVELS.indexOf(item.level);
    const next = ESCALATION_LEVELS[Math.min(idx + 1, ESCALATION_LEVELS.length - 1)]!;
    return escalationRepository.update(id, { level: next, status: "acknowledged" });
  },

  async resolve(id: string) {
    const item = await escalationRepository.findById(id);
    if (!item) {
      throw new NotFoundError("escalation", `Escalation ${id} not found`);
    }
    return escalationRepository.update(id, { level: item.level, status: "resolved" });
  },
};
