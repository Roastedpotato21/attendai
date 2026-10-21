import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { InstitutionSearch } from "@/components/auth/institution-search";
import { VerificationPolicyGate } from "@/components/auth/verification-policy-gate";
import { StaffAuthorityRequest } from "@/components/staff/staff-authority-request";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/db/connection";
import {
  emptyVerificationDetails,
  verificationLabels,
  type VerificationApplication,
  type VerificationDetails,
  type RegistryMatch,
  type VerificationEvidence,
  type EvidenceKind,
} from "@/lib/institution-verification";
import {
  verificationRpc,
  verificationEvidence,
  uploadVerificationEvidence,
  downloadVerificationEvidence,
  deleteVerificationEvidence,
} from "@/lib/services/institution-verification";

export const Route = createFileRoute("/institution-verification")({
  head: () => ({ meta: [{ title: "Institution verification — AttendAI" }] }),
  component: InstitutionVerificationPage,
});
const steps = [
  "Find institution",
  "Institution details",
  "Your role",
  "Authority documents",
  "Identity/photo verification",
  "Submit",
  "Pending verification",
];
type Access = { allowed: boolean; reviewer?: boolean; application_id?: string | null };
type Challenge = { id: string; challenge: string; expires_at: string };

function InstitutionVerificationPage() {
  const { logout } = useAuth();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [application, setApplication] = useState<VerificationApplication | null>(null);
  const [evidence, setEvidence] = useState<VerificationEvidence[]>([]);
  const [details, setDetails] = useState<VerificationDetails>({ ...emptyVerificationDetails });
  const [selected, setSelected] = useState<RegistryMatch | null>(null);
  const [step, setStep] = useState(1);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [recoveryId, setRecoveryId] = useState("");
  const choose = useCallback((match: RegistryMatch | null, query: string) => {
    setSelected(match);
    setDetails((d) => ({
      ...d,
      institution_name: match?.canonical_name ?? query,
      institution_type: match?.institution_type ?? "",
      state: match?.state ?? "",
      city: match?.city ?? "",
      claimed_aishe_code: match?.aishe_code ?? "",
      claimed_website: match?.official_website ?? "",
    }));
    setStep(2);
  }, []);
  const refresh = useCallback(
    async (initial = false) => {
      const { data: identity } = await supabase.auth.getUser();
      if (!identity.user?.email_confirmed_at) {
        setSignedIn(false);
        setReady(true);
        return;
      }
      setSignedIn(true);
      const current = await verificationRpc<Access>("my_institution_verification_access");
      setAccess(current);
      if (current.application_id) {
        const { data, error: loadError } = await supabase
          .from("institution_verification_applications")
          .select("*")
          .eq("id", current.application_id)
          .single();
        if (loadError) throw new Error("Your verification application could not be loaded.");
        const app = data as VerificationApplication;
        setApplication(app);
        setDetails(
          Object.fromEntries(
            Object.keys(emptyVerificationDetails).map((key) => [key, data[key] ?? ""]),
          ) as VerificationDetails,
        );
        setEvidence(await verificationEvidence(app.id));
        if (initial) setStep(["draft", "needs_more_information"].includes(app.status) ? 4 : 7);
      } else if (initial) {
        const hint =
          typeof identity.user.user_metadata["institution_name_hint"] === "string"
            ? identity.user.user_metadata["institution_name_hint"]
            : "";
        setDetails((d) => ({
          ...d,
          applicant_name: String(identity.user?.user_metadata["name"] ?? ""),
          institution_name: hint,
        }));
        // Signup metadata is only a search hint, never a trusted registry match.
        if (hint && identity.user.user_metadata["registry_id_hint"]) {
          const matches = await verificationRpc<RegistryMatch[]>("search_institution_registry", {
            p_query: hint,
          });
          const match = matches.find(
            (m) => m.id === identity.user?.user_metadata["registry_id_hint"],
          );
          if (match) {
            choose(match, hint);
          }
        }
      }
      setReady(true);
    },
    [choose],
  );
  useEffect(() => {
    void refresh(true).catch(() => {
      setError("Verification could not be loaded. Please reload to try again.");
      setReady(true);
    });
  }, [refresh]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Verification action failed.");
    } finally {
      setBusy(false);
    }
  }
  function field(
    key: keyof VerificationDetails,
    label: string,
    type = "text",
    required = true,
    readonly = false,
  ) {
    return (
      <div className="space-y-1" key={key}>
        <Label htmlFor={key}>{label}</Label>
        <Input
          id={key}
          type={type}
          value={details[key]}
          required={required}
          readOnly={readonly}
          maxLength={key === "authority_statement" ? 2000 : 200}
          onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
        />
      </div>
    );
  }
  async function saveDraft() {
    if (application)
      await verificationRpc("save_institution_verification", {
        p_id: application.id,
        p_details: details,
      });
    else
      await verificationRpc("start_institution_verification", {
        p_registry_id: selected?.id ?? null,
        p_details: details,
      });
    await refresh();
    setStep(4);
  }
  function upload(kind: EvidenceKind, label: string) {
    return (
      <div className="rounded-lg border p-3 space-y-2">
        <Label htmlFor={kind}>{label}</Label>
        <Input
          id={kind}
          type="file"
          accept={
            kind === "challenge_photo"
              ? "image/png,image/jpeg"
              : "application/pdf,image/png,image/jpeg"
          }
          capture={kind === "challenge_photo" ? "user" : undefined}
          disabled={busy || !application || (kind === "challenge_photo" && !challenge)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file && application)
              void act(async () => {
                if (file.size > 5 * 1024 * 1024)
                  throw new Error("Each verification file must be 5 MB or smaller.");
                await uploadVerificationEvidence(
                  application.id,
                  kind,
                  file,
                  kind === "challenge_photo" ? challenge?.id : undefined,
                );
                await refresh();
              });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Private storage. PDF/JPEG/PNG only, up to 5 MB. Uploading is not approval.
        </p>
      </div>
    );
  }
  function files() {
    return (
      <ul className="space-y-2">
        {evidence.map((e) => (
          <li key={e.id} className="rounded border p-3 text-sm">
            <strong>{e.kind.replaceAll("_", " ")}</strong>: {e.original_name}
            <span className="block">
              Review: {e.review_state} · Retained until{" "}
              {new Date(e.retention_until).toLocaleDateString()}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => downloadVerificationEvidence(e.id))}
            >
              Download privately
            </Button>
            {application && ["draft", "needs_more_information"].includes(application.status) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await deleteVerificationEvidence(e.id);
                    await refresh();
                  })
                }
              >
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (!ready) return <main className="p-8">Loading verification…</main>;
  if (!signedIn)
    return (
      <main className="mx-auto max-w-xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">Verify your account email to continue</h1>
        <p>
          Use your verification email link, or sign in to your existing applicant account. No
          institution access is granted before review.
        </p>
        <Link to="/login" search={{ redirect: undefined }} className="underline">
          Sign in
        </Link>
        {" · "}
        <Link to="/create-account" className="underline">
          Start registration
        </Link>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <main className="mx-auto max-w-3xl p-4 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Institution verification</h1>
        <Button variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>
      {access?.reviewer && (
        <Link to="/institution-review" className="underline">
          Open platform verification review
        </Link>
      )}
      {error && (
        <p role="alert" className="rounded border border-destructive p-3 text-destructive">
          {error}
        </p>
      )}
      <VerificationPolicyGate>
        <StaffAuthorityRequest />
        {application?.purpose && application.purpose !== "initial" && (
          <p className="rounded border p-3">
            {application.purpose.replaceAll("_", " ")}: fresh authority review for{" "}
            {application.requested_capability?.replaceAll("_", " ")}. Current ownership changes only
            after independent approval.
          </p>
        )}
        {!access?.allowed ? (
          <p>
            Your account cannot submit a new institution claim. Existing staff must use their
            institution's authorized administrator process.
          </p>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                {step === 7 && application
                  ? verificationLabels[application.status]
                  : "Step " + step + " — " + steps[step - 1]}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Two independent proofs are required: institution existence and your authority to
                represent it.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {step < 7 && (
                <ol className="flex flex-wrap gap-2 text-xs" aria-label="Verification progress">
                  {steps.slice(0, 6).map((label, i) => (
                    <li
                      key={label}
                      aria-current={step === i + 1 ? "step" : undefined}
                      className={step === i + 1 ? "font-bold" : ""}
                    >
                      {i + 1}. {label}
                    </li>
                  ))}
                </ol>
              )}
              {step === 1 && (
                <InstitutionSearch onSelect={choose} initialQuery={details.institution_name} />
              )}
              {step === 2 && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setStep(3);
                  }}
                >
                  {selected && (
                    <p className="rounded bg-muted p-3">
                      Official match: {selected.canonical_name} · {selected.state} ·{" "}
                      {selected.institution_type}. This is not representative verification.
                    </p>
                  )}
                  {field(
                    "institution_name",
                    "Institution name",
                    "text",
                    true,
                    !!selected || !!application,
                  )}
                  {field(
                    "institution_type",
                    "Institution type",
                    "text",
                    true,
                    !!selected || !!application,
                  )}
                  {field("state", "State", "text", true, !!selected || !!application)}
                  {field("city", "District / city", "text", false, !!selected || !!application)}
                  {field("claimed_aishe_code", "AISHE / college code, if known", "text", false)}
                  {field("claimed_website", "Official website, if known", "url", false)}
                  {!application && (
                    <Button type="button" variant="outline" onClick={() => setStep(1)}>
                      Back to search
                    </Button>
                  )}
                  <Button type="submit">Continue to your role</Button>
                </form>
              )}
              {step === 3 && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(saveDraft);
                  }}
                >
                  {field("applicant_name", "Your full name")}
                  {field("applicant_phone", "Your contact phone", "tel")}
                  {field(
                    "official_email",
                    "Official institution email, where available",
                    "email",
                    false,
                  )}
                  {field("designation", "Your designation")}
                  <div>
                    <Label htmlFor="leadership_role">Authority role</Label>
                    <select
                      id="leadership_role"
                      className="w-full rounded border bg-background p-2"
                      value={details.leadership_role}
                      onChange={(e) =>
                        setDetails((d) => ({
                          ...d,
                          leadership_role: e.target.value as VerificationDetails["leadership_role"],
                        }))
                      }
                    >
                      <option value="principal">Principal</option>
                      <option value="director">Director</option>
                      <option value="registrar">Registrar</option>
                      <option value="secretary">
                        Secretary / authorized management representative
                      </option>
                      <option value="authorized_representative">
                        Another person explicitly authorized by leadership
                      </option>
                    </select>
                  </div>
                  {field("signatory_name", "Authorization letter signatory")}
                  {field("signatory_designation", "Signatory designation")}
                  {field("authorization_date", "Authorization letter date", "date")}
                  <div>
                    <Label htmlFor="authority_statement">
                      Statement authorizing AttendAI administration
                    </Label>
                    <textarea
                      id="authority_statement"
                      className="w-full rounded border bg-background p-2"
                      value={details.authority_statement}
                      minLength={20}
                      maxLength={2000}
                      required
                      onChange={(e) =>
                        setDetails((d) => ({ ...d, authority_statement: e.target.value }))
                      }
                    />
                  </div>
                  <p className="text-sm">
                    Your authorization letter must be on official letterhead and include your name,
                    designation, institution, AttendAI authorization, authorized signatory,
                    signatory designation and date.
                  </p>
                  <Button type="button" variant="outline" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" disabled={busy}>
                    Save and continue to documents
                  </Button>
                </form>
              )}
              {step === 4 && application && (
                <>
                  <p>
                    Upload the authorization letter and a separate applicable recognition or
                    affiliation document: AISHE/UGC recognition, AICTE approval/EoA, university
                    affiliation, state recognition or equivalent institutional proof.
                  </p>
                  {upload("authorization_letter", "Authorization letter on official letterhead")}
                  {upload("recognition_document", "Institution recognition / affiliation document")}
                  {files()}
                  <Button variant="outline" onClick={() => setStep(2)} disabled={busy}>
                    Edit registration information
                  </Button>
                  <Button
                    onClick={() => setStep(5)}
                    disabled={
                      busy ||
                      !evidence.some((e) => e.kind === "authorization_letter") ||
                      !evidence.some((e) => e.kind === "recognition_document")
                    }
                  >
                    Continue to photo challenge
                  </Button>
                </>
              )}
              {step === 5 && application && (
                <>
                  <p>
                    Create a fresh photo showing you, the clearly visible challenge code, and
                    institution identification context where appropriate. Staff review the photo
                    manually; no facial recognition or biometric comparison is used.
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        setChallenge(
                          await verificationRpc<Challenge>(
                            "issue_institution_verification_challenge",
                            { p_id: application.id },
                          ),
                        ),
                      )
                    }
                  >
                    Generate a 15-minute challenge
                  </Button>
                  {challenge && (
                    <div className="rounded border p-4">
                      <p className="text-lg font-mono font-bold">{challenge.challenge}</p>
                      <p className="text-sm">
                        Upload by {new Date(challenge.expires_at).toLocaleTimeString()}. A used or
                        expired challenge cannot be reused.
                      </p>
                    </div>
                  )}
                  {upload("challenge_photo", "Fresh representative photo with challenge")}
                  {files()}
                  <p className="text-xs">
                    Photos expire after 30 days; documents after 90 days. Access is blocked after
                    expiry and the retention worker removes stored files.
                  </p>
                  <Button variant="outline" onClick={() => setStep(4)}>
                    Back
                  </Button>
                  <Button
                    disabled={busy || !evidence.some((e) => e.kind === "challenge_photo")}
                    onClick={() => setStep(6)}
                  >
                    Review submission
                  </Button>
                </>
              )}
              {step === 6 && application && (
                <>
                  <p>
                    <strong>{application.institution_name}</strong> · {application.state} ·{" "}
                    {application.institution_type}
                  </p>
                  <p>
                    {application.applicant_name} · {application.designation}
                  </p>
                  <p>
                    A registry match or uploaded document alone cannot authorize your account.
                    Independent reviewers will check existence, authority and the photo challenge,
                    then obtain confirmation through independently sourced official institution
                    contacts.
                  </p>
                  {files()}
                  <Button variant="outline" onClick={() => setStep(4)}>
                    Back to evidence
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await verificationRpc("submit_institution_verification", {
                          p_id: application.id,
                        });
                        await refresh();
                        setStep(7);
                      })
                    }
                  >
                    Submit for independent verification
                  </Button>
                </>
              )}
              {step === 7 && application && (
                <>
                  <p>
                    <strong>{application.institution_name}</strong> · {application.state}
                  </p>
                  <p>
                    Registry assessment: {application.registry_confidence.replaceAll("_", " ")}.
                    Sources: {application.matched_sources.join(", ") || "Manual review required"}.
                  </p>
                  {application.decision_reason && (
                    <p className="rounded bg-muted p-3">{application.decision_reason}</p>
                  )}
                  {application.status === "approved" ? (
                    <>
                      <p>
                        This verification review was approved. Current ownership and staff access
                        follow the institution's recorded lifecycle and roles.
                      </p>
                      <Button onClick={() => window.location.assign("/dashboard")}>
                        Continue to dashboard
                      </Button>
                    </>
                  ) : application.status === "rejected" || application.status === "revoked" ? (
                    <p>
                      Your institution access is blocked. Contact the institution's leadership and
                      request authorized administrator review if you need to dispute the decision.
                    </p>
                  ) : (
                    <p>
                      {application.purpose && application.purpose !== "initial"
                        ? "Authority review is pending. This request grants no new capability; existing staff access follows current membership and roles."
                        : "Institution access remains pending. Protected operations are blocked until approval."}{" "}
                      Submission does not guarantee approval.
                    </p>
                  )}
                  {files()}
                  {application.status === "needs_more_information" && (
                    <Button onClick={() => setStep(2)}>Provide requested information</Button>
                  )}
                  {application.status === "draft" && (
                    <Button onClick={() => setStep(4)}>Continue draft</Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act(() => refresh())}
                  >
                    Refresh status
                  </Button>
                </>
              )}
              {(error.toLowerCase().includes("already registered") ||
                application?.status === "rejected" ||
                application?.status === "revoked") && (
                <div className="space-y-3 border-t pt-4">
                  <h2 className="font-semibold">Request authorized administrator review</h2>
                  <p className="text-sm">
                    This records a recovery request. It never merges accounts or grants institution
                    access.
                  </p>
                  <textarea
                    aria-label="Administrator review reason"
                    className="w-full rounded border bg-background p-2"
                    value={recoveryReason}
                    maxLength={2000}
                    onChange={(e) => setRecoveryReason(e.target.value)}
                  />
                  <Button
                    disabled={busy || recoveryReason.trim().length < 20 || !!recoveryId}
                    onClick={() =>
                      void act(async () =>
                        setRecoveryId(
                          await verificationRpc<string>("request_institution_claim_recovery", {
                            p_registry: selected?.id ?? application?.registry_id ?? null,
                            p_name: details.institution_name,
                            p_reason: recoveryReason,
                          }),
                        ),
                      )
                    }
                  >
                    Submit administrator review request
                  </Button>
                  {recoveryId && (
                    <p role="status">
                      Your request was recorded for manual review. No institution access was
                      changed.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </VerificationPolicyGate>
      <footer className="text-sm">
        <Link to="/privacy" className="underline">
          Privacy Policy
        </Link>
        {" · "}
        <Link to="/terms" className="underline">
          Terms & Conditions
        </Link>
      </footer>
    </main>
  );
}
