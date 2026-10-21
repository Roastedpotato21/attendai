import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { academicRpc } from "@/lib/services/student-academics";
import { setupMemberships } from "@/lib/services/staff-setup";
import type { Membership } from "@/lib/staff-setup";
import { PeriodNotificationSettings, PeriodNotificationStatus } from "./period-notifications-panel";
import {
  completePeriodMarks,
  periodCounts,
  type PeriodCatalog,
  type PeriodDetail,
  type PeriodRule,
  type PeriodSession,
  type PeriodStatus,
} from "@/lib/period-attendance";
const selectStyle = "block w-full rounded border bg-background p-2";
type Action = (fn: () => Promise<void>) => Promise<void>;
type Shared = {
  institution: string;
  catalog: PeriodCatalog;
  reason: string;
  busy: boolean;
  act: Action;
};
export function PeriodWorkspace({ page }: { page: "sessions" | "timetable" }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Membership[]>([]),
    [institution, setInstitution] = useState(""),
    [catalog, setCatalog] = useState<PeriodCatalog | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void setupMemberships()
      .then((rows) => {
        if (live) {
          setMembers(rows);
          setInstitution(rows.find((r) => r.id === user?.institutionId)?.id ?? rows[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Workspace unavailable.");
      });
    return () => {
      live = false;
    };
  }, [user?.institutionId]);
  const refresh = useCallback(async () => {
    if (institution)
      setCatalog(
        await academicRpc<PeriodCatalog>("period_timetable_catalog", {
          p_institution: institution,
        }),
      );
  }, [institution]);
  useEffect(() => {
    let live = true;
    setCatalog(null);
    setError("");
    if (institution)
      void academicRpc<PeriodCatalog>("period_timetable_catalog", { p_institution: institution })
        .then((c) => {
          if (live) setCatalog(c);
        })
        .catch((e) => {
          if (live) setError(e instanceof Error ? e.message : "Timetable unavailable.");
        });
    return () => {
      live = false;
    };
  }, [institution]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice("Operation completed.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Operation failed; refresh and review the current record.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <h1 className="text-2xl font-semibold">
        {page === "sessions" ? "Period attendance sessions" : "Institution timetable"}
      </h1>
      <nav className="flex gap-4">
        <Link to="/period-attendance" className="underline">
          Sessions and pending register
        </Link>
        <Link to="/timetable" className="underline">
          Timetable and overrides
        </Link>
      </nav>
      <label>
        Institution
        <select
          className={selectStyle}
          aria-label="Period institution"
          value={institution}
          disabled={busy}
          onChange={(e) => {
            setInstitution(e.target.value);
            setReason("");
          }}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="rounded border border-destructive p-3">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label className="block">
        Reason for schedule, leave or correction changes
        <Input
          aria-label="Period operation reason"
          value={reason}
          minLength={10}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p>
        No unsubmitted session creates absences. Raw marks are retained without an attendance
        percentage policy. Guardian notices require an eligible locked absence and current consented
        delivery registration.
      </p>
      {catalog ? (
        <div key={institution}>
          <PeriodNotificationSettings institution={institution} timezone={catalog.timezone} />
          {page === "sessions" ? (
            <SessionDirectory
              institution={institution}
              catalog={catalog}
              reason={reason}
              busy={busy}
              act={act}
            />
          ) : (
            <TimetableEditor
              institution={institution}
              catalog={catalog}
              reason={reason}
              busy={busy}
              act={act}
            />
          )}
        </div>
      ) : (
        <p>{institution ? "Loading timetable scope…" : "No active institution workspace."}</p>
      )}
    </main>
  );
}
function SessionDirectory(props: Shared) {
  const [from, setFrom] = useState(props.catalog.today),
    [until, setUntil] = useState(props.catalog.today),
    [offset, setOffset] = useState(0),
    [rows, setRows] = useState<PeriodSession[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    setRows(
      await academicRpc<PeriodSession[]>("period_session_directory", {
        p_institution: props.institution,
        p_from: from,
        p_until: until,
        p_offset: offset,
      }),
    );
  }, [props.institution, from, until, offset]);
  useEffect(() => {
    let live = true;
    void academicRpc<PeriodSession[]>("period_session_directory", {
      p_institution: props.institution,
      p_from: from,
      p_until: until,
      p_offset: offset,
    })
      .then((data) => {
        if (live) {
          setRows(data);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Sessions unavailable.");
      });
    return () => {
      live = false;
    };
  }, [props.institution, from, until, offset, props.catalog]);
  return (
    <div className="space-y-4">
      <p>
        Institution date: {props.catalog.today} · {props.catalog.timezone}. Assigned Faculty see
        their sessions; Class Incharge sees sessions for their sections.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          From
          <Input
            aria-label="Session range from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label>
          Until (up to 31 days)
          <Input
            aria-label="Session range until"
            type="date"
            value={until}
            onChange={(e) => {
              setUntil(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <Button variant="outline" disabled={props.busy} onClick={() => void props.act(reload)}>
          Refresh session states
        </Button>
        <Button
          disabled={props.busy || props.reason.trim().length < 10}
          onClick={() =>
            void props.act(async () => {
              await academicRpc("materialize_period_sessions", {
                p_institution: props.institution,
                p_from: from,
                p_until: until,
                p_reason: props.reason,
              });
              await reload();
            })
          }
        >
          Generate scheduled sessions
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "Date / period",
                "Section(s) / subject",
                "Status",
                "Scheduled / substitute faculty",
                "Submitter / time",
                "",
              ].map((x) => (
                <th className="p-2 text-left" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">
                  {s.session_date} · {s.planned.label}
                  <br />
                  {s.planned.slots.join(" + ")}
                  <br />
                  {new Date(s.starts_at).toLocaleTimeString([], {
                    timeZone: props.catalog.timezone,
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td>
                  {s.planned.sections.map((x) => x.name).join(" + ")} · {s.planned.subject_name}
                </td>
                <td>{s.state.replaceAll("_", " ")}</td>
                <td>
                  {s.planned.faculty_name}
                  {s.substitute_name ? ` → ${s.substitute_name}` : ""}
                </td>
                <td>
                  {s.actual_submitter ?? "Not submitted"}
                  <br />
                  {s.submitted_at
                    ? new Date(s.submitted_at).toLocaleString([], {
                        timeZone: props.catalog.timezone,
                      })
                    : ""}
                </td>
                <td>
                  <Button variant="outline" onClick={() => setSelected(s.id)}>
                    Open {s.planned.label}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p>
          No sessions in your current scope and date range. A schedule owner or assigned faculty can
          generate existing timetable occurrences.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!offset || props.busy}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={rows.length <= 100 || props.busy}
          onClick={() => setOffset(offset + 100)}
        >
          Next
        </Button>
      </div>
      {selected && (
        <SessionEditor key={selected} {...props} sessionId={selected} onChanged={reload} />
      )}
    </div>
  );
}
function SessionEditor(props: Shared & { sessionId: string; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<PeriodDetail | null>(null),
    [error, setError] = useState(""),
    [marks, setMarks] = useState<Record<string, string>>({}),
    [confirmation, setConfirmation] = useState(""),
    [substitute, setSubstitute] = useState("");
  const load = useCallback(async () => {
    const d = await academicRpc<PeriodDetail>("period_session_detail", {
      p_session: props.sessionId,
    });
    setDetail(d);
    setMarks(
      Object.fromEntries(
        d.roster.map((r) => [
          r.student_id,
          r.approved_leave
            ? "approved_leave"
            : (r.mark ?? d.draft?.find((x) => x.student_id === r.student_id)?.status ?? ""),
        ]),
      ),
    );
    setConfirmation("");
    setError("");
  }, [props.sessionId]);
  useEffect(() => {
    let live = true;
    void academicRpc<PeriodDetail>("period_session_detail", { p_session: props.sessionId })
      .then((d) => {
        if (live) {
          setDetail(d);
          setMarks(
            Object.fromEntries(
              d.roster.map((r) => [
                r.student_id,
                r.approved_leave
                  ? "approved_leave"
                  : (r.mark ?? d.draft?.find((x) => x.student_id === r.student_id)?.status ?? ""),
              ]),
            ),
          );
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Session unavailable.");
      });
    return () => {
      live = false;
    };
  }, [props.sessionId]);
  const run = (fn: () => Promise<unknown>) =>
    props.act(async () => {
      await fn();
      await load();
      await props.onChanged();
    });
  useEffect(() => {
    if (detail?.session.state !== "grace_period" || !detail.session.lock_at) return;
    const remaining = Date.parse(detail.session.lock_at) - Date.parse(detail.server_time);
    const timer = setTimeout(
      () => {
        void load().catch((e) =>
          setError(e instanceof Error ? e.message : "Refresh session state to verify lock."),
        );
      },
      Math.max(250, Math.min(remaining + 250, 300250)),
    );
    return () => clearTimeout(timer);
  }, [detail?.session.state, detail?.session.lock_at, detail?.server_time, load]);
  if (error) return <p role="alert">{error}</p>;
  if (!detail) return <p>Loading session roster…</p>;
  const s = detail.session,
    counts = periodCounts(detail.roster),
    disabled = props.busy || props.reason.trim().length < 10;
  return (
    <section className="space-y-4 rounded border p-4" aria-label="Session roster">
      <h2 className="text-xl font-semibold">
        {s.planned.label} · {s.planned.subject_name} · {s.state.replaceAll("_", " ")}
      </h2>
      <p>
        Scheduled: {s.planned.faculty_name} · Planned sections:{" "}
        {s.planned.sections.map((x) => x.name).join(" + ")} · Logical slots:{" "}
        {s.planned.slots.join(" + ")}
      </p>
      <p>
        Server time:{" "}
        {new Date(detail.server_time).toLocaleString([], { timeZone: props.catalog.timezone })} ·
        Revision {s.revision}
      </p>
      {s.lock_at && (
        <p>
          Correction deadline / lock:{" "}
          {new Date(s.lock_at).toLocaleString([], { timeZone: props.catalog.timezone })}. The server
          rejects late faculty corrections even if this page was left open.
        </p>
      )}
      <Button variant="outline" disabled={props.busy} onClick={() => void props.act(load)}>
        Refresh roster and authority
      </Button>
      <p>
        Recorded Present: {counts.present} · Absent: {counts.absent} · Approved Leave:{" "}
        {counts.approvedLeave} · Unmarked: {counts.unmarked}
      </p>
      <PeriodNotificationStatus
        session={s.id}
        revision={s.revision}
        names={Object.fromEntries(detail.roster.map((r) => [r.student_id, r.name_snapshot]))}
      />
      {s.state === "cancelled" ? (
        <p>Cancelled: {s.cancel_reason}. No attendance is expected.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Student / section</th>
                  <th>Mark</th>
                  <th>History / correction</th>
                </tr>
              </thead>
              <tbody>
                {detail.roster.map((r) => (
                  <tr key={r.student_id} className="border-t">
                    <td className="p-2">
                      {r.name_snapshot} · {r.admission_snapshot ?? "Not recorded"}
                      <br />
                      {s.planned.sections.find((x) => x.id === r.section_id)?.name}
                    </td>
                    <td>
                      {detail.can_mark ? (
                        <select
                          aria-label={`Mark ${r.student_id}`}
                          className={selectStyle}
                          disabled={props.busy || r.approved_leave}
                          value={r.approved_leave ? "approved_leave" : (marks[r.student_id] ?? "")}
                          onChange={(e) =>
                            setMarks((m) => ({ ...m, [r.student_id]: e.target.value }))
                          }
                        >
                          <option value="">Unmarked — choose explicitly</option>
                          <option value="present">Present</option>
                          <option value="absent">Absent</option>
                          {r.approved_leave && (
                            <option value="approved_leave">Approved Leave (recorded by CI)</option>
                          )}
                        </select>
                      ) : (
                        (r.mark ?? "Unmarked")
                      )}
                    </td>
                    <td>
                      {r.original_status && <p>Original: {r.original_status}</p>}
                      {r.mark &&
                        (detail.can_grace_correct ||
                          (r.can_ci_correct && ["locked", "corrected"].includes(s.state))) && (
                          <MarkCorrection
                            key={`${r.student_id}-${r.mark_revision}`}
                            studentId={r.student_id}
                            current={r.mark}
                            sessionRevision={s.revision}
                            markRevision={r.mark_revision!}
                            sessionId={s.id}
                            disabled={disabled}
                            reason={props.reason}
                            run={run}
                          />
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!detail.roster.length && (
            <p>
              {detail.can_mark
                ? "No active dated student placements. Final Submit is unavailable."
                : "Roster is captured from actual dated placements when opened on/after the session date. You can see only students within your section authority."}
            </p>
          )}
          {detail.can_mark && (
            <div className="space-y-3">
              <Button
                variant="outline"
                disabled={props.busy}
                onClick={() =>
                  void run(() =>
                    academicRpc("save_period_draft", {
                      p_session: s.id,
                      p_revision: s.revision,
                      p_records: detail.roster
                        .filter((r) => r.approved_leave || marks[r.student_id])
                        .map((r) => ({
                          student_id: r.student_id,
                          status: r.approved_leave ? "approved_leave" : marks[r.student_id],
                        })),
                    }),
                  )
                }
              >
                Save unsubmitted draft
              </Button>
              <label>
                Type SUBMIT followed by the complete roster count
                <Input
                  aria-label="Final Submit confirmation"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <Button
                disabled={
                  props.busy ||
                  !detail.roster.length ||
                  confirmation !== `SUBMIT ${detail.roster.length}`
                }
                onClick={() =>
                  void run(() =>
                    academicRpc("submit_period_session", {
                      p_session: s.id,
                      p_revision: s.revision,
                      p_records: completePeriodMarks(detail.roster, marks),
                      p_confirmation: confirmation,
                    }),
                  )
                }
              >
                Final Submit
              </Button>
              <p>
                Drafts are not submitted attendance. Missing marks never become absent
                automatically.
              </p>
            </div>
          )}
        </>
      )}
      {detail.can_substitute && !s.submitted_at && s.state !== "cancelled" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              academicRpc("assign_period_substitute", {
                p_session: s.id,
                p_faculty: substitute || null,
                p_revision: s.revision,
                p_reason: props.reason,
              }),
            );
          }}
        >
          <h3 className="font-semibold">Session-specific substitute (designated owner CI)</h3>
          <select
            aria-label="Session substitute faculty"
            className={selectStyle}
            value={substitute}
            onChange={(e) => setSubstitute(e.target.value)}
          >
            <option value="">Restore original subject faculty</option>
            {props.catalog.faculty.map((f) => (
              <option value={f.id} key={f.id}>
                {f.full_name}
              </option>
            ))}
          </select>
          <Button disabled={disabled}>Assign session marking authority</Button>
        </form>
      )}
      {detail.can_schedule && !s.submitted_at && s.state !== "cancelled" && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void run(() =>
              academicRpc("cancel_period_session", {
                p_session: s.id,
                p_revision: s.revision,
                p_reason: props.reason,
              }),
            )
          }
        >
          Cancel this session with reason
        </Button>
      )}
      {detail.roster.some((r) => r.can_ci_correct) && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void run(() =>
              academicRpc("approve_student_day_leave", {
                p_student: form.get("student"),
                p_day: s.session_date,
                p_reason: props.reason,
              }),
            );
          }}
        >
          <h3 className="font-semibold">Approve full-day leave for remaining sessions</h3>
          <select
            name="student"
            required
            aria-label="Approved leave student"
            className={selectStyle}
          >
            <option value="">Select own-section student</option>
            {detail.roster
              .filter((r) => r.can_ci_correct)
              .map((r) => (
                <option key={r.student_id} value={r.student_id}>
                  {r.name_snapshot}
                </option>
              ))}
          </select>
          <Button disabled={disabled}>Record Approved Leave</Button>
          <p>
            Prior completed sessions retain their marks. Remaining sessions treat recorded leave as
            exempt. No percentage rule is applied.
          </p>
        </form>
      )}
      <details>
        <summary>Session and mark audit history</summary>
        <ul className="space-y-2">
          {detail.history.map((e) => (
            <li key={e.id} className="rounded border p-2">
              {e.action} · {e.created_at} · Actor {e.actor_profile_id}
              {e.student_id ? ` · Student ${e.student_id}` : ""}
              <p>{e.reason}</p>
              <pre className="overflow-auto text-xs">
                {JSON.stringify({ old: e.previous, new: e.current }, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
        <p>Showing the latest 200 permitted events. Full history remains stored.</p>
      </details>
    </section>
  );
}
function MarkCorrection({
  studentId,
  current,
  sessionId,
  sessionRevision,
  markRevision,
  disabled,
  reason,
  run,
}: {
  studentId: string;
  current: PeriodStatus;
  sessionId: string;
  sessionRevision: number;
  markRevision: number;
  disabled: boolean;
  reason: string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [next, setNext] = useState<PeriodStatus>(current);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          academicRpc("correct_period_mark", {
            p_session: sessionId,
            p_student: studentId,
            p_old: current,
            p_new: next,
            p_revision: sessionRevision,
            p_mark_revision: markRevision,
            p_reason: reason,
          }),
        );
      }}
    >
      <select
        aria-label={`Correct ${studentId}`}
        className={selectStyle}
        value={next}
        onChange={(e) => setNext(e.target.value as PeriodStatus)}
      >
        <option value="present">Present</option>
        <option value="absent">Absent</option>
        <option value="approved_leave">Approved Leave (requires recorded leave)</option>
      </select>
      <Button variant="outline" disabled={disabled || next === current}>
        Correct recorded mark
      </Button>
    </form>
  );
}
function TimetableEditor(props: Shared) {
  const schedulable = props.catalog.sections.filter((s) => s.can_schedule);
  const [draft, setDraft] = useState({
      owner_section_id: "",
      subject_id: "",
      faculty_id: "",
      label: "",
      kind: "normal",
      slots: "",
      starts_at: "",
      ends_at: "",
      weekday: "1",
      on_date: "",
      effective_from: "",
      effective_until: "",
    }),
    [sections, setSections] = useState<string[]>([]),
    [mode, setMode] = useState("weekly"),
    [replaces, setReplaces] = useState("");
  const [exception, setException] = useState({ section: "", day: "", rule: "" });
  const owner = props.catalog.sections.find((x) => x.id === draft.owner_section_id),
    disabled = props.busy || props.reason.trim().length < 10;
  const chooseOverride = (r: PeriodRule) => {
    setMode("dated");
    setReplaces(r.id);
    setSections(r.sections);
    setDraft({
      ...r,
      slots: r.slots.join(", "),
      weekday: "",
      on_date: "",
      effective_from: "",
      effective_until: "",
    });
  };
  return (
    <div className="space-y-5">
      <p>
        Define period labels freely. Labs/combined periods use multiple comma-separated labels and
        one time span for one logical session. Schedules use {props.catalog.timezone}. Date ranges
        are at most one year.
      </p>
      {schedulable.length ? (
        <form
          className="grid gap-3 rounded border p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void props.act(async () => {
              const day = draft.on_date;
              await academicRpc("create_timetable_rule", {
                p_institution: props.institution,
                p_details: {
                  ...draft,
                  slots: draft.slots
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                  weekday: mode === "weekly" ? Number(draft.weekday) : null,
                  on_date: mode === "dated" ? day : null,
                  effective_from: mode === "dated" ? day : draft.effective_from,
                  effective_until: mode === "dated" ? day : draft.effective_until,
                },
                p_sections: sections,
                p_reason: props.reason,
                p_replaces: replaces || null,
              });
              setReplaces("");
              setDraft((d) => ({ ...d, label: "", on_date: "" }));
            });
          }}
        >
          <h2 className="text-lg font-semibold md:col-span-2">
            {replaces ? "Dated replacement / period swap" : "Create weekly or special timetable"}
          </h2>
          <label>
            Schedule mode
            <select
              aria-label="Timetable mode"
              className={selectStyle}
              value={mode}
              disabled={!!replaces}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="weekly">Weekly</option>
              <option value="dated">Dated extra / special schedule</option>
            </select>
          </label>
          <label>
            Designated schedule-owner section
            <select
              aria-label="Timetable owner section"
              required
              className={selectStyle}
              value={draft.owner_section_id}
              onChange={(e) => {
                setDraft((d) => ({ ...d, owner_section_id: e.target.value, subject_id: "" }));
                setSections([e.target.value]);
              }}
            >
              <option value="">Select owner section</option>
              {schedulable.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.program_name} / {s.term_name} / {s.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Attached sections (including owner)</legend>
            {props.catalog.sections
              .filter((s) => !owner || s.program_id === owner.program_id)
              .map((s) => (
                <label className="block" key={s.id}>
                  <input
                    type="checkbox"
                    aria-label={`Attach section ${s.id}`}
                    checked={sections.includes(s.id)}
                    disabled={s.id === draft.owner_section_id}
                    onChange={(e) =>
                      setSections((ids) =>
                        e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id),
                      )
                    }
                  />
                  {s.name} · {s.term_name}
                </label>
              ))}
          </fieldset>
          <label>
            Subject
            <select
              aria-label="Timetable subject"
              className={selectStyle}
              required
              value={draft.subject_id}
              onChange={(e) => setDraft((d) => ({ ...d, subject_id: e.target.value }))}
            >
              <option value="">Select actual subject</option>
              {props.catalog.subjects
                .filter((s) => !owner || s.program_id === owner.program_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Scheduled subject faculty
            <select
              aria-label="Timetable faculty"
              className={selectStyle}
              required
              value={draft.faculty_id}
              onChange={(e) => setDraft((d) => ({ ...d, faculty_id: e.target.value }))}
            >
              <option value="">Select faculty with actual dated assignments</option>
              {props.catalog.faculty.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.full_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Session kind
            <select
              aria-label="Timetable kind"
              className={selectStyle}
              value={draft.kind}
              onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
            >
              {["normal", "lab", "combined", "extra"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {(["label", "slots", "starts_at", "ends_at"] as const).map((k) => (
            <label key={k}>
              {k.replaceAll("_", " ")}
              <Input
                aria-label={`Timetable ${k}`}
                required
                type={k.endsWith("_at") ? "time" : "text"}
                maxLength={k === "slots" ? 1200 : 100}
                value={draft[k]}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
            </label>
          ))}
          {mode === "weekly" ? (
            <>
              <label>
                Weekday
                <select
                  aria-label="Timetable weekday"
                  className={selectStyle}
                  value={draft.weekday}
                  onChange={(e) => setDraft((d) => ({ ...d, weekday: e.target.value }))}
                >
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, i) => (
                    <option value={i} key={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              {(["effective_from", "effective_until"] as const).map((k) => (
                <label key={k}>
                  {k.replaceAll("_", " ")}
                  <Input
                    aria-label={`Timetable ${k}`}
                    type="date"
                    required
                    value={draft[k]}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  />
                </label>
              ))}
            </>
          ) : (
            <label>
              Actual session date
              <Input
                aria-label="Timetable on_date"
                type="date"
                required
                value={draft.on_date}
                onChange={(e) => setDraft((d) => ({ ...d, on_date: e.target.value }))}
              />
            </label>
          )}
          <Button disabled={disabled}>Save reviewed timetable</Button>
          {replaces && (
            <Button variant="outline" type="button" onClick={() => setReplaces("")}>
              Stop replacing occurrence
            </Button>
          )}
        </form>
      ) : (
        <p>No schedule-management scope. Assigned Faculty can view their own plans and sessions.</p>
      )}
      <h2 className="text-lg font-semibold">Preserved timetable rules</h2>
      <ul className="space-y-3">
        {props.catalog.rules.map((r) => (
          <li key={r.id} className="rounded border p-3">
            <p>
              {r.label} · {r.kind} · {r.slots.join(" + ")} · {r.on_date ?? `Weekday ${r.weekday}`} ·{" "}
              {r.starts_at}–{r.ends_at} · {r.effective_from}–{r.effective_until} ·{" "}
              {r.active ? "Active" : "Retired"}
            </p>
            <p>
              Sections:{" "}
              {r.sections
                .map((id) => props.catalog.sections.find((s) => s.id === id)?.name ?? id)
                .join(" + ")}
            </p>
            {props.catalog.sections.some((s) => s.id === r.owner_section_id && s.can_schedule) &&
              r.active && (
                <div className="flex gap-2">
                  <Button variant="outline" disabled={props.busy} onClick={() => chooseOverride(r)}>
                    Plan dated replacement for {r.label}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void props.act(async () => {
                        await academicRpc("retire_timetable_rule", {
                          p_rule: r.id,
                          p_revision: r.revision,
                          p_reason: props.reason,
                        });
                      })
                    }
                  >
                    Retire upcoming occurrences of {r.label}
                  </Button>
                </div>
              )}
          </li>
        ))}
      </ul>
      {!!schedulable.length && (
        <form
          className="grid gap-3 rounded border p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void props.act(async () => {
              await academicRpc("add_timetable_exception", {
                p_institution: props.institution,
                p_section: exception.section,
                p_day: exception.day,
                p_rule: exception.rule || null,
                p_reason: props.reason,
              });
            });
          }}
        >
          <h2 className="text-lg font-semibold md:col-span-2">Holiday or cancelled occurrence</h2>
          <label>
            Section
            <select
              aria-label="Exception section"
              className={selectStyle}
              required
              value={exception.section}
              onChange={(e) => setException((d) => ({ ...d, section: e.target.value, rule: "" }))}
            >
              <option value="">Select owner section</option>
              {schedulable.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <Input
              aria-label="Exception date"
              type="date"
              required
              value={exception.day}
              onChange={(e) => setException((d) => ({ ...d, day: e.target.value }))}
            />
          </label>
          <label>
            Occurrence
            <select
              aria-label="Exception rule"
              className={selectStyle}
              value={exception.rule}
              onChange={(e) => setException((d) => ({ ...d, rule: e.target.value }))}
            >
              <option value="">Full-day holiday (future day)</option>
              {props.catalog.rules
                .filter((r) => r.owner_section_id === exception.section && r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
            </select>
          </label>
          <Button disabled={disabled}>Record holiday / cancellation</Button>
        </form>
      )}
      <ul>
        {props.catalog.exceptions.map((e) => (
          <li key={e.id}>
            {e.on_date} · {e.kind} · {e.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
