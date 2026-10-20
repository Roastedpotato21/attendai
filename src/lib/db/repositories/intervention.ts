import { readAllRows } from "../pagination";
import { supabase } from "../connection";
import type { DbIntervention } from "../schema";
import { fromSupabaseError } from "../errors";

export const interventionRepository = {
  async findAll(): Promise<DbIntervention[]> {
    const data = await readAllRows(
      (from, to) => supabase.from("interventions").select("*").order("id").range(from, to),
      "intervention findAll",
    );

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
  },

  async findByStudentId(studentId: string): Promise<DbIntervention[]> {
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
  },

  async create(
    intervention: Omit<DbIntervention, "id" | "institutionId" | "createdAt" | "updatedAt">,
  ): Promise<DbIntervention> {
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
  },

  async update(id: string, updates: Partial<DbIntervention>): Promise<void> {
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
  },
};
