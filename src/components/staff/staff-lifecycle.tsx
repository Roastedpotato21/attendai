import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { setupRpc } from "@/lib/services/staff-setup";
import {
  institutionDay,
  roleLabels,
  setupRoles,
  type Staff,
  type Responsibility,
} from "@/lib/staff-setup";
import type { SetupActions } from "./institution-setup";

type Candidate = {
  id: string;
  profile_id: string;
  name: string;
  email: string;
  designation: string;
};
type Event = {
  id: string;
  action: string;
  actor_profile_id: string;
  target_staff_id: string | null;
  reason: string;
  created_at: string;
  previous: unknown;
  current: unknown;
};
type Overview = {
  candidates: Candidate[];
  events: Event[];
  single_hod: boolean;
  succession: { nominee_staff_id: string | null } | null;
  legacy_duties: { id: string; staff_id: string; class_name: string }[];
};
type AuthorityStatus = {
  id: string;
  purpose: string;
  status: string;
  staff_id: string;
  capability: string;
};
type Decision = { id: string; action: string; to_staff?: string };
const selectClass = "block w-full rounded border bg-background p-2";
export function StaffLifecyclePanel(props: SetupActions & { staff?: Staff | undefined }) {
  const { id, profile, catalog, busy, act, staff } = props;
  const { user } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [requests, setRequests] = useState<AuthorityStatus[]>([]);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [successor, setSuccessor] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("inactive");
  const [leaveUntil, setLeaveUntil] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [closeRoles, setCloseRoles] = useState(false);
  const [returnRoles, setReturnRoles] = useState<string[]>(["staff"]);
  const [assignment, setAssignment] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [substituteUntil, setSubstituteUntil] = useState("");
  const [term, setTerm] = useState("");
  const [historyOn, setHistoryOn] = useState("");
  const [history, setHistory] = useState<(Responsibility & { staff_name: string })[]>([]);
  const today = institutionDay(profile.timezone ?? "Asia/Kolkata");
  const isOwner = !!profile.owner_profile_id && user?.id === profile.owner_profile_id;
  useEffect(() => {
    let live = true;
    void Promise.all([
      setupRpc<Overview>("staff_lifecycle_overview", { p_institution: id }),
      setupRpc<AuthorityStatus[]>("staff_authority_status", { p_institution: id }),
    ])
      .then(([data, status]) => {
        if (live) {
          setOverview(data);
          setRequests(status);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Lifecycle access unavailable.");
      });
    return () => {
      live = false;
    };
  }, [id, catalog]);
  const duties = catalog.responsibilities.filter(
    (a) => a.staff_id === staff?.id && a.active && (a.ended_on ?? a.effective_until) >= today,
  );
  const legacyDuties = overview?.legacy_duties?.filter((a) => a.staff_id === staff?.id) ?? [];
  const candidates = overview?.candidates.filter((c) => c.id !== staff?.id) ?? [];
  const chosen = overview?.candidates.find((c) => c.id === successor);
  function candidateSelect(
    value: string,
    change: (id: string) => void,
    label: string,
    ownership = false,
  ) {
    const options = ownership
      ? (overview?.candidates.filter((c) => c.profile_id !== profile.owner_profile_id) ?? [])
      : candidates;
    return (
      <label>
        {label}
        <select
          aria-label={label}
          className={selectClass}
          required
          value={value}
          onChange={(e) => change(e.target.value)}
        >
          <option value="">Select verified active staff</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.email} — {c.designation}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function scope(a: Responsibility) {
    return [
      a.kind.replaceAll("_", " "),
      catalog.departments.find((d) => d.id === a.department_id)?.name,
      catalog.programs.find((p) => p.id === a.program_id)?.name,
      catalog.sections.find((s) => s.id === a.section_id)?.name,
      catalog.subjects.find((s) => s.id === a.subject_id)?.name,
      `${a.effective_from} to ${a.ended_on ?? a.effective_until}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const reasonField = (
    <label>
      Lifecycle change reason
      <Input
        aria-label="Lifecycle change reason"
        value={reason}
        minLength={10}
        maxLength={2000}
        required
        onChange={(e) => setReason(e.target.value)}
      />
    </label>
  );
  const ready = !busy && reason.trim().length >= 10 && !!overview;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {staff ? "Staff lifecycle & handover" : "Ownership & lifecycle management"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert">{error}</p>}
        {reasonField}
        {staff && (
          <>
            <p>
              {staff.full_name} · {staff.email} · {staff.status}
            </p>
            {profile.owner_profile_id === staff.profile_id && profile.owner_profile_id && (
              <p className="rounded border p-3">
                This person owns the institution. Transfer ownership or complete independent
                emergency recovery before leave or deactivation.
              </p>
            )}
            <h3 className="font-semibold">Review active and scheduled responsibilities</h3>
            {!duties.length && <p>No active or scheduled academic responsibilities.</p>}
            {legacyDuties.map((a) => (
              <label className="block rounded border p-3" key={a.id}>
                <input
                  type="checkbox"
                  checked={decisions[a.id]?.action === "close"}
                  onChange={(e) =>
                    setDecisions((all) => ({
                      ...all,
                      [a.id]: { id: a.id, action: e.target.checked ? "close" : "" },
                    }))
                  }
                />{" "}
                Explicitly close legacy whole-class mapping: {a.class_name}. Its history remains; a
                subject/term is never inferred.
              </label>
            ))}
            {duties.map((a) => (
              <div className="space-y-2 rounded border p-3" key={a.id}>
                <p>{scope(a)}</p>
                <label>
                  Decision for {a.kind.replaceAll("_", " ")}
                  <select
                    className={selectClass}
                    aria-label={`Lifecycle decision ${a.id}`}
                    value={decisions[a.id]?.action ?? ""}
                    onChange={(e) =>
                      setDecisions((all) => ({
                        ...all,
                        [a.id]: { id: a.id, action: e.target.value },
                      }))
                    }
                  >
                    <option value="">Choose a decision</option>
                    <option value="close">Explicitly close this duty</option>
                    <option value="transfer">Transfer permanently</option>
                    {status === "on_leave" && (
                      <option value="substitute">Temporary substitute, then resume</option>
                    )}
                  </select>
                </label>
                {["transfer", "substitute"].includes(decisions[a.id]?.action ?? "") &&
                  candidateSelect(
                    decisions[a.id]?.to_staff ?? "",
                    (target) =>
                      setDecisions((all) => ({
                        ...all,
                        [a.id]: {
                          ...all[a.id],
                          id: a.id,
                          action: all[a.id]?.action ?? "",
                          to_staff: target,
                        },
                      })),
                    `Successor for ${a.id}`,
                  )}
              </div>
            ))}
            {["active", "draft", "invited", "on_leave", "inactive"].includes(staff.status) && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await setupRpc("change_staff_lifecycle", {
                      p_staff: staff.id,
                      p_status: status,
                      p_reason: reason,
                      p_decisions: [...duties, ...legacyDuties].map((a) => decisions[a.id]),
                      p_close_roles: closeRoles,
                      p_leave_until: status === "on_leave" ? leaveUntil : null,
                    });
                    setDecisions({});
                    setCloseRoles(false);
                  });
                }}
              >
                <label>
                  New staff state
                  <select
                    className={selectClass}
                    aria-label="New staff state"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setDecisions({});
                    }}
                  >
                    <option value="inactive">Inactive</option>
                    <option value="left_institution">Left institution</option>
                    {staff.status === "active" && <option value="on_leave">Temporary leave</option>}
                  </select>
                </label>
                {status === "on_leave" && (
                  <label>
                    Leave through
                    <Input
                      aria-label="Leave through"
                      type="date"
                      min={today}
                      required
                      value={leaveUntil}
                      onChange={(e) => setLeaveUntil(e.target.value)}
                    />
                  </label>
                )}
                <p>
                  All current role grants will close. Pending invitations and this institution's
                  access will be revoked immediately. Identity and historical actions remain.
                </p>
                <p>
                  Current grants:{" "}
                  {catalog.roles
                    .filter((r) => r.staff_id === staff.id && r.active)
                    .map((r) => roleLabels[r.role])
                    .join(", ") || "None"}
                  . Admin removal requires the owner.
                </p>
                <label className="flex gap-2">
                  <input
                    aria-label="Confirm role closure"
                    type="checkbox"
                    checked={closeRoles}
                    onChange={(e) => setCloseRoles(e.target.checked)}
                  />
                  I reviewed every duty and explicitly authorize role closure and access
                  restriction.
                </label>
                <Button
                  type="submit"
                  disabled={
                    !ready ||
                    !closeRoles ||
                    legacyDuties.some((a) => decisions[a.id]?.action !== "close") ||
                    duties.some(
                      (a) =>
                        !decisions[a.id]?.action ||
                        (decisions[a.id]?.action !== "close" && !decisions[a.id]?.to_staff),
                    ) ||
                    (!!profile.owner_profile_id && profile.owner_profile_id === staff.profile_id)
                  }
                >
                  Confirm staff state change
                </Button>
              </form>
            )}
            {["on_leave", "inactive", "left_institution"].includes(staff.status) && (
              <div className="space-y-3">
                <h3 className="font-semibold">Explicit reactivation</h3>
                <p>
                  Reactivation appends fresh grants. Closed duties remain closed. A substitute must
                  finish before return.
                </p>
                {setupRoles.map((r) => (
                  <label className="mr-3 inline-flex gap-2" key={r}>
                    <input
                      type="checkbox"
                      disabled={r === "institution_admin" && !isOwner}
                      checked={returnRoles.includes(r)}
                      onChange={(e) =>
                        setReturnRoles((all) =>
                          e.target.checked ? [...all, r] : all.filter((x) => x !== r),
                        )
                      }
                    />
                    {roleLabels[r]}
                  </label>
                ))}
                <Button
                  disabled={!ready || !returnRoles.length}
                  onClick={() =>
                    void act(async () => {
                      await setupRpc("reactivate_staff", {
                        p_staff: staff.id,
                        p_roles: returnRoles,
                        p_reason: reason,
                      });
                    })
                  }
                >
                  Reactivate original staff identity
                </Button>
              </div>
            )}
            {!!duties.length && (
              <form
                className="space-y-3 border-t pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await setupRpc("handover_staff_responsibility", {
                      p_id: assignment,
                      p_successor: successor,
                      p_starts: startsOn,
                      p_reason: reason,
                      p_substitute_until: substituteUntil || null,
                    });
                    setAssignment("");
                  });
                }}
              >
                <h3 className="font-semibold">Dated responsibility transition</h3>
                <label>
                  Responsibility
                  <select
                    required
                    className={selectClass}
                    value={assignment}
                    onChange={(e) => setAssignment(e.target.value)}
                  >
                    <option value="">Select responsibility</option>
                    {duties.map((a) => (
                      <option key={a.id} value={a.id}>
                        {scope(a)}
                      </option>
                    ))}
                  </select>
                </label>
                {candidateSelect(successor, setSuccessor, "Responsibility successor")}
                <label>
                  Successor starts
                  <Input
                    type="date"
                    min={today}
                    required
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                  />
                </label>
                <label>
                  Substitute through (optional)
                  <Input
                    type="date"
                    min={startsOn || today}
                    value={substituteUntil}
                    onChange={(e) => setSubstituteUntil(e.target.value)}
                  />
                </label>
                <p>
                  Successor needs the matching role for the full period. The previous assignment
                  ends the day before. A temporary substitute creates a dated resumption for the
                  original staff member.
                </p>
                <Button disabled={!ready} type="submit">
                  Record dated handover
                </Button>
              </form>
            )}
          </>
        )}
        {isOwner && (
          <details className="space-y-3 border-t pt-3">
            <summary className="font-semibold">Owner-only controls</summary>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await setupRpc("transfer_institution_ownership", {
                    p_institution: id,
                    p_successor: successor,
                    p_expected_owner: profile.owner_profile_id,
                    p_confirmation: confirmation,
                    p_reason: reason,
                  });
                  window.location.assign("/");
                });
              }}
            >
              <h3 className="font-semibold">Transfer institution ownership</h3>
              <p role="note" className="rounded border border-destructive p-3">
                Ownership changes immediately. Your owner capability ends. Verify the successor's
                identity and institutional authority before confirming.
              </p>
              {candidateSelect(successor, setSuccessor, "Ownership successor", true)}
              {chosen && (
                <p>
                  Verified active member: {chosen.name} · {chosen.email} · {chosen.designation}
                </p>
              )}
              <label>
                Type TRANSFER followed by the exact successor email
                <Input
                  aria-label="Ownership transfer confirmation"
                  required
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <Button
                variant="destructive"
                disabled={
                  !ready ||
                  !chosen ||
                  chosen.profile_id === profile.owner_profile_id ||
                  confirmation !== `TRANSFER ${chosen.email}`
                }
                type="submit"
              >
                Confirm ownership transfer
              </Button>
            </form>
            <div className="space-y-3">
              <h3 className="font-semibold">Succession planning</h3>
              <p>A nominee is a planning record. It grants no access or automatic recovery.</p>
              <p>
                Recorded nominee:{" "}
                {overview?.candidates.find((c) => c.id === overview.succession?.nominee_staff_id)
                  ?.name ?? "None currently eligible"}
              </p>
              <Button
                variant="outline"
                disabled={!ready || !chosen}
                onClick={() =>
                  void act(async () => {
                    await setupRpc("save_owner_succession", {
                      p_institution: id,
                      p_nominee: successor,
                      p_reason: reason,
                    });
                  })
                }
              >
                Save selected successor as nominee
              </Button>
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() =>
                  void act(async () => {
                    await setupRpc("save_owner_succession", {
                      p_institution: id,
                      p_nominee: null,
                      p_reason: reason,
                    });
                  })
                }
              >
                Clear nominee
              </Button>
              <Button
                variant="outline"
                disabled={!ready}
                onClick={() =>
                  void act(async () => {
                    await setupRpc("set_staff_responsibility_rules", {
                      p_institution: id,
                      p_single_hod: !overview?.single_hod,
                      p_reason: reason,
                    });
                  })
                }
              >
                {overview?.single_hod
                  ? "Allow multiple HODs"
                  : "Require a single HOD per department"}
              </Button>
              <p>Class Incharge assignments always require non-overlapping section dates.</p>
            </div>
          </details>
        )}
        <details className="space-y-3 border-t pt-3">
          <summary>Academic term rollover and historical responsibility lookup</summary>
          <label>
            Completed term
            <select className={selectClass} value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="">Select completed term</option>
              {catalog.terms
                .filter((t) => t.ends_on < today)
                .map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name} · {t.academic_year}
                  </option>
                ))}
            </select>
          </label>
          <Button
            disabled={!ready || !term}
            onClick={() =>
              void act(async () => {
                await setupRpc("rollover_staff_term", {
                  p_institution: id,
                  p_term: term,
                  p_reason: reason,
                });
              })
            }
          >
            Expire completed term assignments
          </Button>
          <p>
            Staff identities carry forward. Create and assign the next term through Programs and
            Roles & Assignments.
          </p>
          <label>
            Responsibilities on date
            <Input type="date" value={historyOn} onChange={(e) => setHistoryOn(e.target.value)} />
          </label>
          <Button
            variant="outline"
            disabled={busy || !historyOn}
            onClick={() =>
              void act(async () => {
                setHistory(
                  await setupRpc("staff_responsibility_history", {
                    p_institution: id,
                    p_on: historyOn,
                  }),
                );
              })
            }
          >
            Look up historical holders
          </Button>
          <ul>
            {history.map((a) => (
              <li key={a.id}>
                {a.staff_name} · {scope(a)}
              </li>
            ))}
          </ul>
        </details>
        <details>
          <summary>Emergency recovery and leadership replacement status</summary>
          <p>
            Successors request fresh authority review through Institution verification. Independent
            platform review, clean evidence and actual official confirmation are required. No
            ownership is granted by an email request.
          </p>
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                {catalog.staff.find((s) => s.id === r.staff_id)?.full_name} ·{" "}
                {r.purpose.replaceAll("_", " ")} · {r.capability.replaceAll("_", " ")} ·{" "}
                {r.status.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
          {!requests.length && <p>No authority review requests.</p>}
        </details>
        <details>
          <summary>Lifecycle audit history (latest 100)</summary>
          <ul className="space-y-2">
            {overview?.events.map((e) => (
              <li key={e.id} className="rounded border p-2">
                {e.action} · {e.created_at} · actor {e.actor_profile_id} · target{" "}
                {e.target_staff_id ?? "institution"}
                <p>{e.reason}</p>
                <details>
                  <summary>Previous and new state</summary>
                  <pre className="whitespace-pre-wrap text-xs">
                    {JSON.stringify({ previous: e.previous, current: e.current }, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
