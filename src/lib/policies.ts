export const POLICY_VERSION = "2026-10-15.1";
export const POLICY_CONTACT_MESSAGE =
  import.meta.env?.["VITE_POLICY_CONTACT"]?.trim() ||
  "For privacy, support, or data-related requests, please contact your institution administrator.";

export const policies = {
  terms: { title: "Terms & Conditions", version: POLICY_VERSION },
  privacy: { title: "Privacy Policy", version: POLICY_VERSION },
} as const;

export type PolicyType = keyof typeof policies;
