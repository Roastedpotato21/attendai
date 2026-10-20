import type { PostgrestError } from "@supabase/supabase-js";
import { fromSupabaseError } from "./errors.ts";

/** Read all visible rows instead of silently accepting the API's row limit. */
export async function readAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  operation: string,
): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await page(offset, offset + pageSize - 1);
    if (error) throw fromSupabaseError(operation, error);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
