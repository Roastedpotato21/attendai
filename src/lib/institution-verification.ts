export const verificationStates = [
  "draft",
  "submitted",
  "registry_check",
  "needs_more_information",
  "pending_manual_review",
  "pending_institution_confirmation",
  "approved",
  "rejected",
  "revoked",
] as const;
export type VerificationState = (typeof verificationStates)[number];
export type EvidenceKind = "authorization_letter" | "recognition_document" | "challenge_photo";
export type VerificationDetails = {
  institution_name: string;
  institution_type: string;
  state: string;
  city: string;
  claimed_aishe_code: string;
  claimed_website: string;
  applicant_name: string;
  applicant_phone: string;
  official_email: string;
  designation: string;
  leadership_role:
    "principal" | "director" | "registrar" | "secretary" | "authorized_representative";
  signatory_name: string;
  signatory_designation: string;
  authorization_date: string;
  authority_statement: string;
};
export type VerificationApplication = VerificationDetails & {
  id: string;
  institution_id: string;
  registry_id: string | null;
  status: VerificationState;
  registry_confidence: string;
  matched_sources: string[];
  revision: number;
  submitted_at: string | null;
  decision_reason: string | null;
  created_at: string;
  applicant_profile_id: string;
  account_email: string;
};
export type VerificationEvidence = {
  id: string;
  application_id: string;
  kind: EvidenceKind;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  scan_state: string;
  review_state: string;
  retention_until: string;
  deleted_at: string | null;
  challenge_id: string | null;
  review_revision: number | null;
};
export type RegistryMatch = {
  id: string;
  canonical_name: string;
  institution_type: string;
  state: string;
  city: string | null;
  aishe_code: string | null;
  sources: string[];
  official_website: string | null;
};
export const verificationLabels: Record<VerificationState, string> = {
  draft: "Draft",
  submitted: "Pending verification",
  registry_check: "Registry check",
  needs_more_information: "Needs more information",
  pending_manual_review: "Pending verification",
  pending_institution_confirmation: "Pending institution confirmation",
  approved: "Approved",
  rejected: "Rejected",
  revoked: "Revoked",
};
export const emptyVerificationDetails: VerificationDetails = {
  institution_name: "",
  institution_type: "",
  state: "",
  city: "",
  claimed_aishe_code: "",
  claimed_website: "",
  applicant_name: "",
  applicant_phone: "",
  official_email: "",
  designation: "",
  leadership_role: "authorized_representative",
  signatory_name: "",
  signatory_designation: "",
  authorization_date: "",
  authority_statement: "",
};
