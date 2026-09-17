/**
 * Audit log data-access service.
 */

import type { AuditLog } from "@/lib/types";
import { auditRepository, userRepository } from "../db/repositories";

export interface AuditService {
  getAll(): Promise<AuditLog[]>;
  log(
    action: string,
    target: string,
    severity: AuditLog["severity"],
    actorId?: string,
    ip?: string,
  ): Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockAuditService: AuditService = {
  async getAll() {
    await delay(300);
    const dbLogs = await auditRepository.findAll();

    // We fetch all users to do mapping since we don't have a joined view yet
    const users = await userRepository.findAll();

    return dbLogs.map((l) => {
      // Find actor name for the UI mapping
      const actor = users.find((u) => u.id === l.actorId);
      return {
        id: l.id,
        actor: actor ? actor.name : "Unknown System",
        action: l.action,
        target: l.target,
        ip: l.ip,
        at: l.createdAt,
        severity: l.severity,
      };
    });
  },

  async log(
    action: string,
    target: string,
    severity: AuditLog["severity"],
    actorId,
    ip = "127.0.0.1",
  ) {
    await auditRepository.createLog({
      actorId: actorId ?? null,
      action,
      target,
      severity,
      ip,
    });
  },
};

export const auditService: AuditService = mockAuditService;
