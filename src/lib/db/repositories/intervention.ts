import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbIntervention } from "../schema";
import { fromSupabaseError } from "../errors";

export const interventionRepository = {
  async findAll(): Promise<DbIntervention[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("interventions").select("*");

      if (error) throw fromSupabaseError("intervention list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        institutionId: d.institution_id,
        studentId: d.student_id,
        riskLevel: d.risk_level as DbIntervention["riskLevel"],
        reason: d.reason,
        status: d.status as DbIntervention["status"],
        actionTaken: d.action_taken,
        actionDate: d.action_date,
        ownerId: d.owner_id,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    return [...memoryDb.interventions];
  },

  async findByStudentId(studentId: string): Promise<DbIntervention[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("interventions")
        .select("*")
        .eq("student_id", studentId);

      if (error) throw fromSupabaseError("student intervention list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        institutionId: d.institution_id,
        studentId: d.student_id,
        riskLevel: d.risk_level as DbIntervention["riskLevel"],
        reason: d.reason,
        status: d.status as DbIntervention["status"],
        actionTaken: d.action_taken,
        actionDate: d.action_date,
        ownerId: d.owner_id,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    return memoryDb.interventions.filter((i) => i.studentId === studentId);
  },

  async create(
    intervention: Omit<DbIntervention, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbIntervention> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("interventions")
        .insert({
          student_id: intervention.studentId,
          risk_level: intervention.riskLevel,
          reason: intervention.reason,
          status: intervention.status,
          owner_id: intervention.ownerId,
        })
        .select()
        .single();

      if (error) throw fromSupabaseError("intervention create", error);
      if (!data) throw fromSupabaseError("intervention create");

      return {
        id: data.id,
        institutionId: data.institution_id,
        studentId: data.student_id,
        riskLevel: data.risk_level,
        reason: data.reason,
        status: data.status,
        actionTaken: data.action_taken,
        actionDate: data.action_date,
        ownerId: data.owner_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const newIntervention: DbIntervention = {
      ...intervention,
      id: `intervention-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      institutionId:
        memoryDb.students.find((item) => item.id === intervention.studentId)?.institutionId ??
        "mock-institution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryDb.interventions.push(newIntervention);
    return newIntervention;
  },

  async update(id: string, updates: Partial<DbIntervention>): Promise<void> {
    if (hasDatabaseConnection() && supabase) {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.status) updateData["status"] = updates.status;
      if (updates.actionTaken !== undefined) updateData["action_taken"] = updates.actionTaken;
      if (updates.actionDate !== undefined) updateData["action_date"] = updates.actionDate;
      if (updates.ownerId !== undefined) updateData["owner_id"] = updates.ownerId;

      const { error } = await supabase.from("interventions").update(updateData).eq("id", id);
      if (error) throw fromSupabaseError("intervention update", error);
      return;
    }

    const index = memoryDb.interventions.findIndex((i) => i.id === id);
    if (index !== -1) {
      const existing = memoryDb.interventions[index];
      if (!existing) return;
      if (updates.status) existing.status = updates.status;
      if (updates.actionTaken !== undefined) existing.actionTaken = updates.actionTaken;
      if (updates.actionDate !== undefined) existing.actionDate = updates.actionDate;
      if (updates.ownerId !== undefined) existing.ownerId = updates.ownerId;
      existing.updatedAt = new Date().toISOString();
    }
  },
};
