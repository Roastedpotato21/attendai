import { memoryDb, hasDatabaseConnection, supabase } from "../connection";
import type { DbParent } from "../schema";
import { fromSupabaseError } from "../errors";

export const parentRepository = {
  async findById(id: string): Promise<DbParent | null> {
    if (hasDatabaseConnection() && supabase) {
      const { data, error } = await supabase.from("parents").select("*").eq("id", id).maybeSingle();

      if (error) throw fromSupabaseError("parent lookup", error);
      if (!data) return null;

      return {
        id: data.id,
        institutionId: data.institution_id,
        userId: data.user_id,
        name: data.name,
        phone: data.phone,
        language: data.language as DbParent["language"],
        preferredChannel: data.preferred_channel as DbParent["preferredChannel"],
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }

    return memoryDb.parents.find((p) => p.id === id) || null;
  },
};
