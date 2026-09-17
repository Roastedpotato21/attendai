import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbUser } from "../schema";
import { fromSupabaseError } from "../errors";

export const userRepository = {
  async findById(id: string): Promise<DbUser | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw fromSupabaseError("profile lookup", error);
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        studentId: data.student_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const user = memoryDb.users.find((u) => u.id === id);
    return user || null;
  },

  async findByEmail(email: string): Promise<DbUser | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (error) throw fromSupabaseError("profile email lookup", error);
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        studentId: data.student_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    const user = memoryDb.users.find((u) => u.email === email);
    return user || null;
  },

  async findAll(): Promise<DbUser[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw fromSupabaseError("profile list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        name: d.name,
        email: d.email,
        role: d.role,
        studentId: d.student_id,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    return memoryDb.users;
  },
};
