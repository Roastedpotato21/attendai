import { hasDatabaseConnection, supabase, memoryDb } from "../connection";
import type { Escalation, EscalationLevel, EscalationStatus } from "@/lib/types";
import { fromSupabaseError } from "../errors";

function mapEscalation(row: {
  id: string;
  reason: string;
  level: string;
  status: string;
  created_at: string;
  students: { name: string } | { name: string }[] | null;
  classes: { full_name: string } | { full_name: string }[] | null;
  profiles: { name: string } | { name: string }[] | null;
}): Escalation {
  const student = Array.isArray(row.students) ? row.students[0] : row.students;
  const assignedClass = Array.isArray(row.classes) ? row.classes[0] : row.classes;
  const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

  return {
    id: row.id,
    student: student?.name ?? "Unknown student",
    className: assignedClass?.full_name ?? "Unknown class",
    reason: row.reason,
    level: row.level as EscalationLevel,
    raisedAt: row.created_at,
    owner: owner?.name ?? "Unassigned",
    status: row.status as EscalationStatus,
  };
}

const escalationSelect =
  "id, reason, level, status, created_at, students(name), classes(full_name), profiles(name)";

export const escalationRepository = {
  async findAll(): Promise<Escalation[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("escalations")
        .select(escalationSelect)
        .order("created_at", { ascending: false });

      if (error) throw fromSupabaseError("escalation list", error);
      return data ? data.map(mapEscalation) : [];
    }

    // Mock mode: build from in-memory data
    return memoryDb.escalations.map((e) => {
      const student = memoryDb.students.find((s) => s.id === e.studentId);
      const cls = memoryDb.classes.find((c) => c.id === e.classId);
      const owner = memoryDb.users.find((u) => u.id === e.ownerId);

      return {
        id: e.id,
        student: student?.name ?? "Unknown student",
        className: cls?.fullName ?? "Unknown class",
        reason: e.reason,
        level: e.level,
        raisedAt: e.createdAt,
        owner: owner?.name ?? "Unassigned",
        status: e.status,
      };
    });
  },

  async findById(id: string): Promise<Escalation | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("escalations")
        .select(escalationSelect)
        .eq("id", id)
        .maybeSingle();

      if (error) throw fromSupabaseError(`escalation ${id} lookup`, error);
      return data ? mapEscalation(data) : null;
    }

    const existing = memoryDb.escalations.find((e) => e.id === id);
    if (!existing) return null;
    const student = memoryDb.students.find((s) => s.id === existing.studentId);
    const cls = memoryDb.classes.find((c) => c.id === existing.classId);
    const owner = memoryDb.users.find((u) => u.id === existing.ownerId);
    return {
      id: existing.id,
      student: student?.name ?? "Unknown student",
      className: cls?.fullName ?? "Unknown class",
      reason: existing.reason,
      level: existing.level,
      raisedAt: existing.createdAt,
      owner: owner?.name ?? "Unassigned",
      status: existing.status,
    };
  },

  async update(id: string, updates: Pick<Escalation, "level" | "status">): Promise<Escalation> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("escalations")
        .update({
          level: updates.level,
          status: updates.status,
          acknowledged_at: updates.status === "acknowledged" ? new Date().toISOString() : null,
          resolved_at: updates.status === "resolved" ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .select(escalationSelect)
        .single();

      if (error) throw fromSupabaseError(`escalation ${id} update`, error);
      if (!data) throw fromSupabaseError(`escalation ${id} update`);
      return mapEscalation(data);
    }

    // Mock mode: update in-memory
    const idx = memoryDb.escalations.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Escalation ${id} not found`);
    const existing = memoryDb.escalations[idx]!;
    existing.level = updates.level;
    existing.status = updates.status;
    existing.updatedAt = new Date().toISOString();

    const student = memoryDb.students.find((s) => s.id === existing.studentId);
    const cls = memoryDb.classes.find((c) => c.id === existing.classId);
    const owner = memoryDb.users.find((u) => u.id === existing.ownerId);

    return {
      id: existing.id,
      student: student?.name ?? "Unknown student",
      className: cls?.fullName ?? "Unknown class",
      reason: existing.reason,
      level: existing.level,
      raisedAt: existing.createdAt,
      owner: owner?.name ?? "Unassigned",
      status: existing.status,
    };
  },
};
