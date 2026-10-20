import { readAllRows } from "../pagination";
import { supabase } from "../connection";
import type { DbClass } from "../schema";
import { fromSupabaseError } from "../errors";

export const classRepository = {
  async findManageable(): Promise<DbClass[]> {
    const classes = await this.findAll();
    const client = supabase;
    const allowed = await Promise.all(
      classes.map(async (cls) => {
        const { data, error } = await client.rpc("can_manage_class", {
          target_class_id: cls.id,
        });
        if (error) throw fromSupabaseError("attendance class access", error);
        return data === true ? cls : null;
      }),
    );
    return allowed.filter((cls): cls is DbClass => cls !== null);
  },
  async findByName(name: string): Promise<DbClass | null> {
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
  },

  async findById(id: string): Promise<DbClass | null> {
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
  },

  async findAll(): Promise<DbClass[]> {
    const data = await readAllRows(
      (from, to) => supabase.from("classes").select("*").order("id").range(from, to),
      "class findAll",
    );

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
  },
};
