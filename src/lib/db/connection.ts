import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigurationError } from "./errors";

const readEnv = (key: string): string | undefined => import.meta.env[key];
const supabaseUrl = readEnv("VITE_SUPABASE_URL");
const supabaseKey = readEnv("VITE_SUPABASE_ANON_KEY");
const dataMode = readEnv("VITE_DATA_MODE");

if (dataMode && dataMode !== "supabase") {
  throw new ConfigurationError(
    "connection",
    "AttendAI requires Supabase. Demo data mode is no longer supported.",
  );
}
if (!supabaseUrl || !supabaseKey) {
  throw new ConfigurationError(
    "connection",
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must both be configured.",
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true },
});
export const hasDatabaseConnection = (): boolean => true;
export function requireSupabase(): SupabaseClient {
  return supabase;
}
