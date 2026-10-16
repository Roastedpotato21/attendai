import { supabase } from "@/lib/db/connection";
import { POLICY_VERSION } from "@/lib/policies";

export type CurrentPolicy = {
  id: string;
  type: "terms" | "privacy";
  version: string;
  accepted: boolean;
};

export async function currentPolicies(): Promise<CurrentPolicy[]> {
  if (!supabase) throw new Error("Policy verification requires Supabase.");
  const { data, error } = await supabase.rpc("my_policy_status");
  if (error || !Array.isArray(data)) throw new Error("Current policies could not be verified.");
  const records = data as CurrentPolicy[];
  if (
    records.length !== 2 ||
    !records.some((v) => v.type === "terms") ||
    !records.some((v) => v.type === "privacy")
  ) {
    throw new Error("Current policies are not configured.");
  }
  return records;
}

export async function acceptPolicies(method: "signup" | "access_gate"): Promise<void> {
  if (!supabase) throw new Error("Policy acceptance requires Supabase.");
  const records = await currentPolicies();
  if (records.some((record) => record.version !== POLICY_VERSION))
    throw new Error(
      "Policy pages are being updated. Please try again after the new version is published.",
    );
  const terms = records.find((v) => v.type === "terms")!;
  const privacy = records.find((v) => v.type === "privacy")!;
  const { error } = await supabase.rpc("accept_current_policies", {
    p_terms: terms.id,
    p_privacy: privacy.id,
    p_method: method,
  });
  if (error) throw new Error("Your acceptance could not be saved. Please try again.");
}
