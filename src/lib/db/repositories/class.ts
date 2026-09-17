import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbClass } from "../schema";
import { fromSupabaseError } from "../errors";

export const classRepository = {
  async findByName(name: string): Promise<DbClass | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("name", name)
        .limit(1)
        .maybeSingle();

      if (error) throw fromSupabaseError("class name lookup", error);
      if (!data) return null;

      return {
        id: data.id,
        institutionId: data.institution_id,
        name: data.name,
        section: data.section,
        fullName: data.full_name,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    return memoryDb.classes.find((c) => c.name === name || c.fullName === name) || null;
  },

  async findById(id: string): Promise<DbClass | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("classes").select("*").eq("id", id).maybeSingle();

      if (error) throw fromSupabaseError("class lookup", error);
      if (!data) return null;

      return {
        id: data.id,
        institutionId: data.institution_id,
        name: data.name,
        section: data.section,
        fullName: data.full_name,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    return memoryDb.classes.find((c) => c.id === id) || null;
  },

  async findAll(): Promise<DbClass[]> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("classes").select("*");

      if (error) throw fromSupabaseError("class list", error);
      if (!data) return [];

      return data.map((d) => ({
        id: d.id,
        institutionId: d.institution_id,
        name: d.name,
        section: d.section,
        fullName: d.full_name,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      }));
    }

    return [...memoryDb.classes];
  },
};
