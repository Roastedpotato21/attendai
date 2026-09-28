import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbAuditLog } from "../schema";
import { fromSupabaseError } from "../errors";

export const auditRepository = {
  async findAll(): Promise<DbAuditLog[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw fromSupabaseError("audit log list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        institutionId: d.institution_id,
        actorId: d.actor_id ?? null,
        action: d.action,
        target: d.target,
        ip: d.ip,
        severity: d.severity,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    // Sort descending by timestamp
    return [...memoryDb.auditLogs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  },

  async createLog(
    log: Omit<DbAuditLog, "id" | "institutionId" | "createdAt" | "updatedAt"> & {
      institutionId?: string;
    },
  ): Promise<DbAuditLog> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("audit_logs")
        .insert({
          institution_id: log.institutionId,
          actor_id: log.actorId,
          action: log.action,
          target: log.target,
          ip: log.ip,
          severity: log.severity,
        })
        .select()
        .single();

      if (error) {
        // Audit insert failures should be logged but not necessarily fatal.
        // If RLS denies the insert, we warn instead of crashing the parent operation.
        console.error(`[Audit] Failed to write audit log (${error.code}): ${error.message}`, {
          action: log.action,
          target: log.target,
        });
        throw fromSupabaseError("audit log create", error);
      }
      if (!data) throw fromSupabaseError("audit log create");

      return {
        id: data.id,
        institutionId: data.institution_id,
        actorId: data.actor_id ?? null,
        action: data.action,
        target: data.target,
        ip: data.ip,
        severity: data.severity,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const newLog: DbAuditLog = {
      ...log,
      id: `audit-${Date.now()}`,
      institutionId: log.institutionId ?? "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryDb.auditLogs.unshift(newLog);
    return newLog;
  },
};
