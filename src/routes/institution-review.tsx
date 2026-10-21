import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { VerificationPolicyGate } from "@/components/auth/verification-policy-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/db/connection";
import {
  verificationLabels,
  verificationStates,
  type VerificationApplication,
  type VerificationEvidence,
} from "@/lib/institution-verification";
import {
  verificationRpc,
  verificationEvidence,
  downloadVerificationEvidence,
} from "@/lib/services/institution-verification";

export const Route = createFileRoute("/institution-review")({
  head: () => ({ meta: [{ title: "Institution verification review — AttendAI" }] }),
  component: InstitutionReview,
});
type Contact = {
  id: string;
  kind: "email" | "phone";
  contact_value: string;
  source_kind: string;
  source_url: string;
  independence_note: string;
};
type Confirmation = {
  id: string;
  confirmed: boolean;
  confirmation_method: string;
  confirmed_by: string;
  confirmer_designation: string;
  confirmed_at: string;
  evidence_reference: string;
  application_revision: number;
};
type Review = {
  id: string;
  decision: string;
  reason: string;
  created_at: string;
  application_revision: number;
};
type Recovery = {
  id: string;
  institution_name: string;
  reason: string;
  status: string;
  created_at: string;
};

function InstitutionReview() {
  const { logout } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [applications, setApplications] = useState<VerificationApplication[]>([]);
  const [queuePage, setQueuePage] = useState(0);
  const [queueStatus, setQueueStatus] = useState("pending_manual_review");
  const [queueHasMore, setQueueHasMore] = useState(false);
  const [recovery, setRecovery] = useState<Recovery[]>([]);
  const [selected, setSelected] = useState<VerificationApplication | null>(null);
  const [evidence, setEvidence] = useState<VerificationEvidence[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [challenges, setChallenges] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [scanned, setScanned] = useState(false);
  const [contents, setContents] = useState(false);
  const [existence, setExistence] = useState(false);
  const [authority, setAuthority] = useState(false);
  const [kind, setKind] = useState<"email" | "phone">("email");
  const [contactValue, setContactValue] = useState("");
  const [sourceKind, setSourceKind] = useState("official_directory");
  const [sourceUrl, setSourceUrl] = useState("");
  const [independence, setIndependence] = useState("");
  const [contactId, setContactId] = useState("");
  const [confirmer, setConfirmer] = useState("");
  const [designation, setDesignation] = useState("");
  const [outcome, setOutcome] = useState("");
  const [reference, setReference] = useState("");
  const loadQueue = useCallback(async (page = 0, status = "pending_manual_review") => {
    const { data, error: queueError } = await supabase
      .from("institution_verification_applications")
      .select("*")
      .eq("status", status)
      .order("created_at")
      .order("id")
      .range(page * 50, page * 50 + 50);
    if (queueError) throw new Error("Verification queue is unavailable.");
    setApplications(data.slice(0, 50) as VerificationApplication[]);
    setQueuePage(page);
    setQueueStatus(status);
    setQueueHasMore(data.length > 50);
    const { data: requests, error: recoveryError } = await supabase
      .from("institution_claim_recovery_requests")
      .select("id,institution_name,reason,status,created_at")
      .eq("status", "pending")
      .order("created_at")
      .limit(100);
    if (recoveryError) throw new Error("Administrator recovery queue is unavailable.");
    setRecovery(requests as Recovery[]);
  }, []);
  async function open(app: VerificationApplication) {
    const { data: latest, error: loadError } = await supabase
      .from("institution_verification_applications")
      .select("*")
      .eq("id", app.id)
      .single();
    if (loadError) throw new Error("Application is unavailable.");
    setSelected(latest as VerificationApplication);
    setEvidence(await verificationEvidence(app.id));
    const [contactResult, confirmationResult, reviewResult, challengeResult] = await Promise.all([
      supabase
        .from("institution_official_contacts")
        .select("*")
        .eq("application_id", app.id)
        .order("sourced_at"),
      supabase
        .from("institution_authority_confirmations")
        .select("*")
        .eq("application_id", app.id)
        .order("confirmed_at"),
      supabase
        .from("institution_verification_reviews")
        .select("id,decision,reason,created_at,application_revision")
        .eq("application_id", app.id)
        .order("created_at"),
      supabase
        .from("institution_verification_challenges")
        .select("id,challenge")
        .eq("application_id", app.id),
    ]);
    if (
      contactResult.error ||
      confirmationResult.error ||
      reviewResult.error ||
      challengeResult.error
    )
      throw new Error("Private review history could not be loaded.");
    setContacts(contactResult.data as Contact[]);
    setConfirmations(confirmationResult.data as Confirmation[]);
    setReviews(reviewResult.data as Review[]);
    setChallenges(Object.fromEntries(challengeResult.data.map((c) => [c.id, c.challenge])));
  }
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user?.email_confirmed_at) {
        setAllowed(false);
        return;
      }
      const isReviewer = await verificationRpc<boolean>("is_verification_reviewer");
      setAllowed(isReviewer);
      if (isReviewer) await loadQueue();
    })().catch(() => {
      setAllowed(false);
      setError("Reviewer access could not be verified.");
    });
  }, [loadQueue]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice("Review action recorded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review action failed.");
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: string) {
    if (!selected) return;
    await verificationRpc("review_institution_application", {
      p_id: selected.id,
      p_decision: decision,
      p_reason: reason,
      p_existence_verified: existence,
      p_authority_verified: authority,
    });
    await loadQueue(queuePage, queueStatus);
    await open(selected);
    setReason("");
    setExistence(false);
    setAuthority(false);
  }
  if (allowed === null) return <main className="p-8">Checking platform reviewer access…</main>;
  if (!allowed)
    return (
      <main className="mx-auto max-w-xl p-8 space-y-4">
        <h1 className="text-xl font-semibold">Platform reviewer access required</h1>
        <p>Institution administrators and applicants cannot approve verification applications.</p>
        {error && <p role="alert">{error}</p>}
        <Link to="/login" search={{ redirect: undefined }} className="underline">
          Sign in
        </Link>
        {" · "}
        <Link to="/institution-verification" className="underline">
          Your application
        </Link>
      </main>
    );
  return (
    <main className="mx-auto max-w-6xl p-4 space-y-5">
      <header className="flex justify-between gap-4">
        <h1 className="text-2xl font-semibold">Institution verification review</h1>
        <Button variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>
      <p className="text-sm">
        Platform review only. Do not contact applicant-provided numbers or document contacts as the
        sole confirmation source. This console records manual outbound verification; it sends no
        messages.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <VerificationPolicyGate>
        <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <h2 className="font-semibold">Applications</h2>
            <Label htmlFor="queue-status">Application status</Label>
            <select
              id="queue-status"
              className="w-full rounded border bg-background p-2"
              value={queueStatus}
              disabled={busy}
              onChange={(e) => void act(() => loadQueue(0, e.target.value))}
            >
              {verificationStates.map((status) => (
                <option key={status} value={status}>
                  {verificationLabels[status]}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || queuePage === 0}
                onClick={() => void act(() => loadQueue(queuePage - 1, queueStatus))}
              >
                Previous
              </Button>
              <span className="text-sm">Page {queuePage + 1}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !queueHasMore}
                onClick={() => void act(() => loadQueue(queuePage + 1, queueStatus))}
              >
                Next
              </Button>
            </div>
            {applications.length === 0 && <p>No applications on this page.</p>}
            {applications.map((app) => (
              <button
                key={app.id}
                className="block w-full rounded border p-3 text-left text-sm hover:bg-muted"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setReason("");
                    setScanned(false);
                    setContents(false);
                    setEvidenceNote("");
                    await open(app);
                  })
                }
              >
                <strong>{app.institution_name}</strong>
                <span className="block">{(app.purpose ?? "initial").replaceAll("_", " ")}</span>
                <span className="block">
                  {app.state} · {verificationLabels[app.status]}
                </span>
              </button>
            ))}
            <h2 className="font-semibold pt-4">Authorized administrator requests</h2>
            {recovery.map((r) => (
              <div key={r.id} className="rounded border p-3 text-sm">
                <strong>{r.institution_name}</strong>
                <p>{r.reason}</p>
                <p>{r.status}; no access granted</p>
              </div>
            ))}
          </aside>
          <section className="space-y-5">
            {selected ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{selected.institution_name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {selected.purpose && selected.purpose !== "initial" && (
                      <div className="rounded border border-destructive p-3">
                        <strong>{selected.purpose.replaceAll("_", " ")}</strong>
                        <p>
                          Approval grants {selected.requested_capability?.replaceAll("_", " ")} to
                          this successor. Confirm the current leadership situation independently.
                          The original institutional verification remains unchanged.
                        </p>
                        <p>{selected.request_reason}</p>
                      </div>
                    )}
                    <p>
                      {selected.state} · {selected.city} · {selected.institution_type}
                    </p>
                    <p>
                      Registry: {selected.registry_confidence}; matched sources:{" "}
                      {selected.matched_sources.join(", ") ||
                        "none — independently verify recognition"}
                    </p>
                    <p>
                      Claimed code: {selected.claimed_aishe_code || "not supplied"}; website:{" "}
                      {selected.claimed_website || "not supplied"}
                    </p>
                    <p>
                      Applicant: {selected.applicant_name}, {selected.designation} (
                      {selected.leadership_role.replaceAll("_", " ")})
                    </p>
                    <p>Verified account email: {selected.account_email}</p>
                    <p>
                      Applicant contact: {selected.applicant_phone}; claimed official email:{" "}
                      {selected.official_email || "not supplied"}. These are not independent contact
                      proof.
                    </p>
                    <p>
                      Authorization signatory: {selected.signatory_name},{" "}
                      {selected.signatory_designation}; dated {selected.authorization_date}
                    </p>
                    <p>{selected.authority_statement}</p>
                    <p>
                      Status: {verificationLabels[selected.status]}; revision {selected.revision}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Private evidence review</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm">
                      Download as an attachment, scan with the institution verification
                      malware-check process, and inspect the actual document. Never mark an
                      unscanned or unchecked upload accepted. Photo review checks the visible
                      challenge and context; no facial recognition is performed.
                    </p>
                    <Label htmlFor="evidence-note">
                      Private evidence review notes (at least 20 characters)
                    </Label>
                    <textarea
                      id="evidence-note"
                      className="w-full rounded border bg-background p-2"
                      value={evidenceNote}
                      onChange={(e) => setEvidenceNote(e.target.value)}
                    />
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={scanned}
                        onChange={(e) => setScanned(e.target.checked)}
                      />
                      I have completed an external malware scan and it is clean.
                    </label>
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={contents}
                        onChange={(e) => setContents(e.target.checked)}
                      />
                      I checked all required letter/recognition fields, or the visible fresh photo
                      challenge and institutional context.
                    </label>
                    {evidence.map((e) => (
                      <div key={e.id} className="rounded border p-3 space-y-2 text-sm">
                        <strong>{e.kind.replaceAll("_", " ")}</strong>
                        <p>
                          {e.original_name} · {e.scan_state} · {e.review_state} (reviewed revision{" "}
                          {e.review_revision ?? "none"})
                        </p>
                        {e.challenge_id && (
                          <p className="font-mono">
                            {challenges[e.challenge_id] ?? "Challenge unavailable"}
                          </p>
                        )}
                        <p>Retention ends {new Date(e.retention_until).toLocaleString()}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void act(() => downloadVerificationEvidence(e.id))}
                        >
                          Download privately
                        </Button>
                        <Button
                          size="sm"
                          disabled={
                            busy ||
                            !scanned ||
                            !contents ||
                            evidenceNote.trim().length < 20 ||
                            !["pending_manual_review", "pending_institution_confirmation"].includes(
                              selected.status,
                            )
                          }
                          onClick={() =>
                            void act(async () => {
                              await verificationRpc("review_institution_evidence", {
                                p_id: e.id,
                                p_scan: "clean",
                                p_accept: true,
                                p_reason: evidenceNote,
                              });
                              await open(selected);
                              setScanned(false);
                              setContents(false);
                              setEvidenceNote("");
                            })
                          }
                        >
                          Accept reviewed evidence
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            busy ||
                            evidenceNote.trim().length < 20 ||
                            !["pending_manual_review", "pending_institution_confirmation"].includes(
                              selected.status,
                            )
                          }
                          onClick={() =>
                            void act(async () => {
                              await verificationRpc("review_institution_evidence", {
                                p_id: e.id,
                                p_scan: scanned ? "clean" : "rejected",
                                p_accept: false,
                                p_reason: evidenceNote,
                              });
                              await open(selected);
                            })
                          }
                        >
                          Reject evidence
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Independently sourced official contacts</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {contacts.map((c) => (
                      <div key={c.id} className="rounded border p-3 text-sm">
                        <strong>
                          {c.kind}: {c.contact_value}
                        </strong>
                        <p>
                          Source: {c.source_kind} — {c.source_url}
                        </p>
                        <p>{c.independence_note}</p>
                      </div>
                    ))}
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          await verificationRpc("record_institution_official_contact", {
                            p_id: selected.id,
                            p_kind: kind,
                            p_value: contactValue,
                            p_source_kind: sourceKind,
                            p_source_url: sourceUrl,
                            p_independence_note: independence,
                          });
                          await open(selected);
                          setContactValue("");
                          setSourceUrl("");
                          setIndependence("");
                        });
                      }}
                    >
                      <Label htmlFor="contact-kind">Official contact method</Label>
                      <select
                        id="contact-kind"
                        className="w-full rounded border bg-background p-2"
                        value={kind}
                        onChange={(e) => setKind(e.target.value as "email" | "phone")}
                      >
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                      </select>
                      <Label htmlFor="official-contact">Official contact value</Label>
                      <Input
                        id="official-contact"
                        value={contactValue}
                        onChange={(e) => setContactValue(e.target.value)}
                        required
                        maxLength={254}
                      />
                      <Label htmlFor="source-kind">Independent source</Label>
                      <select
                        id="source-kind"
                        className="w-full rounded border bg-background p-2"
                        value={sourceKind}
                        onChange={(e) => setSourceKind(e.target.value)}
                      >
                        <option value="official_directory">Official published directory</option>
                        <option value="registry">Trusted registry</option>
                        <option value="official_website">
                          Independently verified official institution website
                        </option>
                      </select>
                      <Label htmlFor="source-url">Source URL</Label>
                      <Input
                        id="source-url"
                        type="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        required
                      />
                      <Label htmlFor="independence">
                        How this contact was obtained independently
                      </Label>
                      <textarea
                        id="independence"
                        className="w-full rounded border bg-background p-2"
                        value={independence}
                        onChange={(e) => setIndependence(e.target.value)}
                        minLength={20}
                        required
                      />
                      <Button
                        disabled={
                          busy ||
                          !["pending_manual_review", "pending_institution_confirmation"].includes(
                            selected.status,
                          )
                        }
                      >
                        Record official contact
                      </Button>
                    </form>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Official-contact confirmation</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {confirmations.map((c) => (
                      <div key={c.id} className="rounded border p-3 text-sm">
                        <strong>{c.confirmed ? "Confirmed" : "Not confirmed"}</strong>
                        <p>
                          {c.confirmed_by} · {c.confirmer_designation} · {c.confirmation_method} ·
                          revision {c.application_revision}
                        </p>
                        <p>{c.evidence_reference}</p>
                        <p>{new Date(c.confirmed_at).toLocaleString()}</p>
                      </div>
                    ))}
                    <form
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          const contact = contacts.find((c) => c.id === contactId);
                          if (!contact)
                            throw new Error("Choose an independently sourced official contact.");
                          await verificationRpc("record_institution_authority_confirmation", {
                            p_id: selected.id,
                            p_contact: contactId,
                            p_method:
                              contact.kind === "email"
                                ? "manual_official_email"
                                : "manual_official_phone",
                            p_confirmer: confirmer,
                            p_designation: designation,
                            p_confirmed: outcome === "confirmed",
                            p_reference: reference,
                          });
                          await open(selected);
                          setReference("");
                          setOutcome("");
                        });
                      }}
                    >
                      <Label htmlFor="confirm-contact">
                        Contact actually used for independent confirmation
                      </Label>
                      <select
                        id="confirm-contact"
                        className="w-full rounded border bg-background p-2"
                        value={contactId}
                        onChange={(e) => setContactId(e.target.value)}
                        required
                      >
                        <option value="">Choose official contact</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.kind}: {c.contact_value}
                          </option>
                        ))}
                      </select>
                      <Label htmlFor="confirmer">Confirming officer name</Label>
                      <Input
                        id="confirmer"
                        value={confirmer}
                        onChange={(e) => setConfirmer(e.target.value)}
                        required
                      />
                      <Label htmlFor="confirmer-designation">Confirming officer designation</Label>
                      <Input
                        id="confirmer-designation"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        required
                      />
                      <Label htmlFor="confirmation-result">Actual response</Label>
                      <select
                        id="confirmation-result"
                        className="w-full rounded border bg-background p-2"
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                        required
                      >
                        <option value="">Choose recorded outcome</option>
                        <option value="confirmed">
                          Officer explicitly confirmed applicant authority
                        </option>
                        <option value="denied">Officer did not confirm authority</option>
                      </select>
                      <Label htmlFor="confirmation-evidence">
                        Private response/call record reference
                      </Label>
                      <Input
                        id="confirmation-evidence"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        minLength={10}
                        required
                      />
                      <Button
                        disabled={busy || selected.status !== "pending_institution_confirmation"}
                      >
                        Record actual confirmation
                      </Button>
                    </form>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Decision</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Label htmlFor="decision-reason">
                      Applicant-visible reason (at least 20 characters; do not include private
                      contact details)
                    </Label>
                    <textarea
                      id="decision-reason"
                      className="w-full rounded border bg-background p-2"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={existence}
                        onChange={(e) => setExistence(e.target.checked)}
                      />
                      Institution existence independently verified, including official recognition
                      sources.
                    </label>
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={authority}
                        onChange={(e) => setAuthority(e.target.checked)}
                      />
                      Applicant authority and all required evidence have been reviewed and accepted.
                    </label>
                    {["pending_manual_review", "pending_institution_confirmation"].includes(
                      selected.status,
                    ) && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={busy || reason.trim().length < 20 || !existence || !authority}
                          onClick={() => void act(() => decide("pending_institution_confirmation"))}
                        >
                          Request institution confirmation
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || reason.trim().length < 20}
                          onClick={() => void act(() => decide("needs_more_information"))}
                        >
                          Request more information
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || reason.trim().length < 20}
                          onClick={() => void act(() => decide("rejected"))}
                        >
                          Reject application
                        </Button>
                        {selected.status === "pending_institution_confirmation" && (
                          <Button
                            disabled={busy || reason.trim().length < 20}
                            onClick={() => void act(() => decide("approved"))}
                          >
                            Approve and activate initial owner
                          </Button>
                        )}
                      </div>
                    )}
                    {selected.status === "approved" && (
                      <Button
                        variant="destructive"
                        disabled={busy || reason.trim().length < 20}
                        onClick={() => void act(() => decide("revoked"))}
                      >
                        Revoke institution authorization
                      </Button>
                    )}
                    <h3 className="font-semibold">Immutable review history</h3>
                    {reviews.map((r) => (
                      <div key={r.id} className="border-t py-2 text-sm">
                        <strong>{r.decision}</strong> · revision {r.application_revision}
                        <p>{r.reason}</p>
                        <p>{new Date(r.created_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            ) : (
              <p>
                Select an application to review. Registry search and uploads never auto-approve it.
              </p>
            )}
          </section>
        </div>
      </VerificationPolicyGate>
    </main>
  );
}
