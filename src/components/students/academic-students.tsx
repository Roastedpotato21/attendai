import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { supabase } from "@/lib/db/connection";
import { setupMemberships } from "@/lib/services/staff-setup";
import {
  academicCatalog,
  academicDirectory,
  academicProfile,
  academicRpc,
  loadStudentBatch,
} from "@/lib/services/student-academics";
import type {
  AcademicCatalog,
  AcademicProfile,
  AcademicStudent,
  StudentBatch,
  ImportPreviewRow,
} from "@/lib/student-academics";
import { importSummary } from "@/lib/student-academics";
import {
  parseStudentFile,
  studentFileHash,
  studentImportColumns,
  guardianRelationshipColumns,
  type StudentImportRow,
} from "@/lib/student-import";
import { StudentGuardians } from "@/components/students/student-guardians";
import type { Membership } from "@/lib/staff-setup";

type PageKind = "directory" | "import" | "cohorts" | "promotion";
type Props = {
  institution: string;
  catalog: AcademicCatalog;
  busy: boolean;
  reason: string;
  act: (fn: () => Promise<void>) => Promise<void>;
};
const selectClass = "block w-full rounded border bg-background p-2";
const links = [
  ["/students", "Students"],
  ["/student-import", "Student Import"],
  ["/cohorts", "Batches / Cohorts"],
  ["/student-promotion", "Promotion"],
] as const;
export function AcademicStudentsPage({ page }: { page: PageKind }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Membership[]>([]);
  const [id, setId] = useState("");
  const [catalog, setCatalog] = useState<AcademicCatalog | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    let live = true;
    void setupMemberships()
      .then((m) => {
        if (live) {
          setMembers(m);
          setId(m.find((x) => x.id === user?.institutionId)?.id ?? m[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (live) setError("Active institution access could not be verified.");
      });
    return () => {
      live = false;
    };
  }, [user?.institutionId]);
  const refresh = useCallback(async () => {
    if (id) setCatalog(await academicCatalog(id));
  }, [id]);
  useEffect(() => {
    let live = true;
    setCatalog(null);
    if (id)
      void academicCatalog(id)
        .then((c) => {
          if (live) setCatalog(c);
        })
        .catch((e) => {
          if (live) setError(e instanceof Error ? e.message : "Academic setup unavailable.");
        });
    return () => {
      live = false;
    };
  }, [id]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice("Operation completed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Academic operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const props = catalog ? { institution: id, catalog, busy, reason, act } : null;
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">
          {page === "directory"
            ? "Students"
            : page === "import"
              ? "Student Import"
              : page === "cohorts"
                ? "Batches / Cohorts"
                : "Cohort promotion"}
        </h1>
        <label>
          Institution
          <select
            className={selectClass}
            value={id}
            disabled={busy}
            onChange={(e) => {
              setId(e.target.value);
              setError("");
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
        <nav className="flex flex-wrap gap-3" aria-label="Student academics">
          {links
            .filter(
              ([path]) => catalog?.can_import || ["/students", "/student-promotion"].includes(path),
            )
            .map(([path, label]) => (
              <Link key={path} to={path} className="underline">
                {label}
              </Link>
            ))}
        </nav>
      </header>
      {error && (
        <p role="alert" className="rounded border border-destructive p-3">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label className="block">
        Reason for academic changes
        <Input
          aria-label="Academic change reason"
          value={reason}
          required
          minLength={10}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {!props ? (
        <p>{id ? "Loading academic records…" : "No active workspace selected."}</p>
      ) : (
        <div key={id}>
          {page === "directory" ? (
            <StudentDirectory {...props} />
          ) : page === "import" ? (
            catalog?.can_import ? (
              <StudentImport {...props} />
            ) : (
              <p>Current institution owner/admin access is required to import students.</p>
            )
          ) : page === "cohorts" ? (
            catalog?.can_import ? (
              <Cohorts {...props} />
            ) : (
              <p>Institution owner/admin access is required to manage cohorts.</p>
            )
          ) : catalog?.can_manage ? (
            <Promotion {...props} />
          ) : (
            <p>
              Owner/admin or a current scoped HOD, Coordinator or Class Incharge responsibility is
              required.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
function TargetFields({
  catalog,
  value,
  onChange,
}: {
  catalog: AcademicCatalog;
  value: { section_id: string; cohort_id: string; starts_on: string };
  onChange: (v: { section_id: string; cohort_id: string; starts_on: string }) => void;
}) {
  const section = catalog.sections.find((s) => s.id === value.section_id);
  const field = (key: "section_id" | "cohort_id" | "starts_on", v: string) =>
    onChange({ ...value, [key]: v, ...(key === "section_id" ? { cohort_id: "" } : {}) });
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label>
        Target section
        <select
          required
          aria-label="Target section"
          className={selectClass}
          value={value.section_id}
          onChange={(e) => field("section_id", e.target.value)}
        >
          <option value="">Select program / term / section</option>
          {catalog.sections.map((s) => (
            <option value={s.id} key={s.id}>
              {catalog.programs.find((p) => p.id === s.program_id)?.name} /{" "}
              {catalog.terms.find((t) => t.id === s.term_id)?.academic_year} /{" "}
              {catalog.terms.find((t) => t.id === s.term_id)?.name} / {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Target cohort
        <select
          required
          aria-label="Target cohort"
          className={selectClass}
          value={value.cohort_id}
          onChange={(e) => field("cohort_id", e.target.value)}
        >
          <option value="">Select recorded cohort</option>
          {catalog.cohorts
            .filter((c) => !section || c.program_id === section.program_id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
        </select>
      </label>
      <label>
        Effective date
        <Input
          aria-label="Placement effective date"
          required
          type="date"
          value={value.starts_on}
          onChange={(e) => field("starts_on", e.target.value)}
        />
      </label>
    </div>
  );
}
function StudentDirectory(props: Props) {
  const [query, setQuery] = useState(""),
    [cohort, setCohort] = useState(""),
    [offset, setOffset] = useState(0),
    [students, setStudents] = useState<AcademicStudent[]>([]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const reload = useCallback(async () => {
    setStudents(await academicDirectory(props.institution, query, cohort || null, offset));
  }, [props.institution, query, cohort, offset]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void academicDirectory(props.institution, query, cohort || null, offset)
        .then((data) => {
          if (live) {
            setStudents(data);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e instanceof Error ? e.message : "Student directory unavailable.");
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [props.institution, query, cohort, offset, props.catalog]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input
          aria-label="Search academic students"
          placeholder="Search name, admission or roll number"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <label>
          Cohort
          <select
            aria-label="Student cohort filter"
            className={selectClass}
            value={cohort}
            onChange={(e) => {
              setCohort(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All visible cohorts</option>
            {props.catalog.cohorts.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <p>
        Showing {students.slice(0, 100).length} records in your authorized scope. Legacy records
        without academic entry details need explicit review.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Student", "Admission / Roll", "Current placement", "Cohort / Entry", "Status"].map(
                (h) => (
                  <th className="p-2 text-left" key={h}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {students.slice(0, 100).map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">
                  <button className="underline" onClick={() => setSelected(s.id)}>
                    {s.name}
                  </button>
                </td>
                <td>
                  {s.admission_number ?? "Not recorded"} / {s.roll ?? "Not recorded"}
                </td>
                <td>
                  {[
                    s.program_name,
                    s.term_name,
                    s.year_number ? `Year ${s.year_number}` : "",
                    s.section_name,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No current academic placement"}
                </td>
                <td>
                  {s.cohort_name ?? "Not recorded"} / {s.entry_type ?? "Not recorded"}
                </td>
                <td>{s.enrollment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!students.length && <p>No students found in this scope.</p>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={students.length <= 100}
          onClick={() => setOffset(offset + 100)}
        >
          Next
        </Button>
      </div>
      {selected && (
        <StudentProfile key={selected} {...props} studentId={selected} onChanged={reload} />
      )}
    </div>
  );
}
function StudentProfile(props: Props & { studentId: string; onChanged: () => Promise<void> }) {
  const [profile, setProfile] = useState<AcademicProfile | null>(null),
    [error, setError] = useState("");
  const [status, setStatus] = useState("inactive");
  const [target, setTarget] = useState({ section_id: "", cohort_id: "", starts_on: "" });
  const [change, setChange] = useState("section_transfer");
  const [details, setDetails] = useState({ full_name: "", admission_number: "", roll_number: "" });
  const load = useCallback(async () => {
    const p = await academicProfile(props.studentId);
    setProfile(p);
    setDetails({
      full_name: p.student.name,
      admission_number: p.student.admission_number ?? "",
      roll_number: p.student.roll ?? "",
    });
  }, [props.studentId]);
  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Profile unavailable."));
  }, [load, props.catalog]);
  async function update(work: () => Promise<unknown>) {
    await props.act(async () => {
      await work();
      await load();
      await props.onChanged();
    });
  }
  if (error) return <p role="alert">{error}</p>;
  if (!profile) return <p>Loading student profile…</p>;
  const s = profile.student;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Student profile — {s.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-2 md:grid-cols-2">
          <div>
            <dt>Canonical student ID</dt>
            <dd>{s.id}</dd>
          </div>
          <div>
            <dt>Admission / Roll</dt>
            <dd>
              {s.admission_number ?? "Not recorded"} / {s.roll ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt>Admission date / Entry type</dt>
            <dd>
              {s.admitted_on ?? "Not recorded"} / {s.entry_type ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt>Actual entry term / cohort</dt>
            <dd>
              {profile.entry_term?.name ?? "Not recorded"} /{" "}
              {profile.entry_cohort?.name ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{s.enrollment_status}</dd>
          </div>
        </dl>
        <h3 className="font-semibold">Current placement</h3>
        <p>
          {profile.current
            ? [
                profile.current.department_name,
                profile.current.program_name,
                profile.current.cohort_name,
                profile.current.term_name,
                profile.current.section_name,
                profile.current.starts_on + " — " + profile.current.ends_on,
              ].join(" · ")
            : "No current academic placement recorded."}
        </p>
        {!s.academic_managed && (
          <p>
            Review this existing identity through Student Import using enroll_existing and its
            recorded identifiers. No missing academic history is inferred.
          </p>
        )}
        {profile.can_edit && (
          <details>
            <summary>Correct student identity</summary>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void update(() =>
                  academicRpc("update_student_academic_profile", {
                    p_student: s.id,
                    p_details: details,
                    p_expected_version: s.academic_version,
                    p_reason: props.reason,
                  }),
                );
              }}
            >
              {(["full_name", "admission_number", "roll_number"] as const).map((k) => (
                <label className="block" key={k}>
                  {k.replaceAll("_", " ")}
                  <Input
                    value={details[k]}
                    maxLength={k === "full_name" ? 120 : 80}
                    required={k !== "roll_number"}
                    onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
                  />
                </label>
              ))}
              <Button disabled={props.busy || props.reason.trim().length < 10}>
                Save identity correction
              </Button>
            </form>
          </details>
        )}
        {profile.can_move && s.academic_managed && s.enrollment_status === "active" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void update(() =>
                academicRpc("student_placement_transition", {
                  p_student: s.id,
                  p_target: { ...target, change_type: change },
                  p_expected_version: s.academic_version,
                  p_reason: props.reason,
                }),
              );
            }}
          >
            <h3 className="font-semibold">Move / repeat / return placement</h3>
            <TargetFields catalog={props.catalog} value={target} onChange={setTarget} />
            <label>
              Change type
              <select
                className={selectClass}
                value={change}
                onChange={(e) => setChange(e.target.value)}
              >
                {[
                  "section_transfer",
                  "department_transfer",
                  "program_transfer",
                  "repeat",
                  "return_from_break",
                  "correction",
                ].map((v) => (
                  <option key={v} value={v}>
                    {v.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={props.busy || props.reason.trim().length < 10}>
              Record placement change
            </Button>
          </form>
        )}
        {profile.can_move && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void update(() =>
                academicRpc("change_student_academic_status", {
                  p_student: s.id,
                  p_status: status,
                  p_expected_version: s.academic_version,
                  p_reason: props.reason,
                }),
              );
            }}
          >
            <h3 className="font-semibold">Student status</h3>
            <select
              aria-label="New academic student status"
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "active",
                "inactive",
                "graduated",
                "transferred_out",
                "discontinued",
                "suspended",
              ].map((v) => (
                <option key={v} value={v}>
                  {v.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <p>
              Leaving active status closes current/scheduled academic placement. Identity and
              history remain. Reactivation requires an explicit new placement.
            </p>
            <Button
              disabled={
                props.busy || status === s.enrollment_status || props.reason.trim().length < 10
              }
            >
              Confirm student status
            </Button>
          </form>
        )}
        <h3 className="font-semibold">Placement history</h3>
        <ul className="space-y-2">
          {profile.history.map((p) => (
            <li className="rounded border p-3" key={p.id}>
              <strong>
                {p.program_name} · {p.term_name} · {p.section_name}
              </strong>
              <p>
                {p.department_name} · {p.cohort_name} ·{" "}
                {p.ends_on < p.starts_on
                  ? `Scheduled ${p.starts_on} — cancelled before start`
                  : `${p.starts_on} — ${p.ends_on}`}
              </p>
              <p>
                {p.change_type.replaceAll("_", " ")} · {p.reason}
              </p>
              <p className="text-xs">
                Actor {p.created_by} · {p.created_at}
                {p.close_reason ? ` · Closure: ${p.close_reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
        {!profile.history.length && <p>No academic placement history has been recorded.</p>}
        <StudentGuardians
          studentId={s.id}
          reason={props.reason}
          busy={props.busy}
          act={props.act}
        />
      </CardContent>
    </Card>
  );
}
function Cohorts(props: Props) {
  const [draft, setDraft] = useState({
    name: "",
    code: "",
    program_id: "",
    starts_on: "",
    expected_ends_on: "",
    description: "",
  });
  return (
    <div className="space-y-4">
      <p>
        Cohort dates and labels describe admission groups. They never calculate a student's current
        year.
      </p>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void props.act(async () => {
            await academicRpc("create_student_cohort", {
              p_institution: props.institution,
              p_details: draft,
              p_reason: props.reason,
            });
            setDraft({ ...draft, name: "", code: "" });
          });
        }}
      >
        <label>
          Program / course
          <select
            className={selectClass}
            aria-label="Cohort program"
            required
            value={draft.program_id}
            onChange={(e) => setDraft((d) => ({ ...d, program_id: e.target.value }))}
          >
            <option value="">Select institution program</option>
            {props.catalog.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </label>
        {(["name", "code", "starts_on", "expected_ends_on", "description"] as const).map((k) => (
          <label key={k}>
            {k.replaceAll("_", " ")}
            <Input
              aria-label={`Cohort ${k}`}
              type={["starts_on", "expected_ends_on"].includes(k) ? "date" : "text"}
              required={k !== "description"}
              value={draft[k]}
              maxLength={k === "description" ? 1000 : 160}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          </label>
        ))}
        <Button disabled={props.busy || props.reason.trim().length < 10}>Create cohort</Button>
      </form>
      <ul className="space-y-2">
        {props.catalog.cohorts.map((c) => (
          <li className="rounded border p-3" key={c.id}>
            {c.name} ({c.code}) · {props.catalog.programs.find((p) => p.id === c.program_id)?.name}{" "}
            · {c.starts_on} — {c.expected_ends_on}
            <p>{c.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
function PreviewSummary({ batch }: { batch: StudentBatch }) {
  const s = importSummary(batch.preview);
  return (
    <p role="status">
      Valid rows: {s.valid} · Warnings: {s.warnings} · Rejected rows: {s.rejected} · Existing
      students: {s.existing} · Potential duplicates: {s.potential} · Skipped: {s.skipped} · Revision{" "}
      {batch.revision} · {batch.status}
    </p>
  );
}
function ImportRowEditor({
  row,
  busy,
  guardianOnly = false,
  onSave,
}: {
  row: ImportPreviewRow;
  busy: boolean;
  guardianOnly?: boolean;
  onSave: (data: StudentImportRow) => void;
}) {
  const [draft, setDraft] = useState<StudentImportRow>({ ...row.data });
  useEffect(() => setDraft({ ...row.data }), [row.data]);
  return (
    <details className="rounded border p-3">
      <summary>
        Row {row.row_number}: {String(row.data.full_name ?? "")} — {row.outcome}
      </summary>
      <ul>
        {row.errors.map((e, i) => (
          <li className="text-destructive" key={i}>
            {e}
          </li>
        ))}
        {row.warnings.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      {!!row.existing_students?.length && (
        <p>
          Existing identities:{" "}
          {row.existing_students
            .map((s) => `${s.name} (${s.admission_number}, ${s.id})`)
            .join("; ")}
        </p>
      )}
      {!!row.potential_duplicates?.length && (
        <p>
          Possible matches:{" "}
          {row.potential_duplicates.map((s) => `${s.name} (${s.admission_number})`).join("; ")}
        </p>
      )}
      <div className="grid gap-2 md:grid-cols-3">
        {(guardianOnly ? guardianRelationshipColumns : studentImportColumns).map((k) => (
          <label key={k}>
            {k.replaceAll("_", " ")}
            <Input
              value={String(draft[k] ?? "")}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <label>
        Resolution
        <select
          aria-label={`Row ${row.row_number} resolution`}
          className={selectClass}
          value={String(draft.action ?? "create")}
          onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
        >
          <option value="create">
            {guardianOnly
              ? "Link reviewed guardian to existing student"
              : "Create new canonical identity"}
          </option>
          <option value="skip">Skip this row</option>
          {!guardianOnly && (
            <option value="enroll_existing">Enroll reviewed existing identity</option>
          )}
        </select>
      </label>
      {!!row.guardian?.matches?.length && (
        <div>
          <p>
            Guardian candidates: confirm exact name/mobile before setting guardian_id. No automatic
            merge.
          </p>
          <ul>
            {row.guardian.matches.map((g) => (
              <li key={g.id}>
                {g.name} · {g.phone} · ID {g.id}
              </li>
            ))}
          </ul>
        </div>
      )}
      {draft.action === "enroll_existing" && (
        <label>
          Existing identity
          <select
            className={selectClass}
            value={String(draft.existing_student_id ?? "")}
            onChange={(e) => setDraft((d) => ({ ...d, existing_student_id: e.target.value }))}
          >
            <option value="">Select exact matching admission identity</option>
            {row.existing_students?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.admission_number} · {s.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {!!row.potential_duplicates?.length && (
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={
              draft.duplicate_acknowledged === true || draft.duplicate_acknowledged === "true"
            }
            onChange={(e) => setDraft((d) => ({ ...d, duplicate_acknowledged: e.target.checked }))}
          />
          I checked these matches and confirmed this is a different student.
        </label>
      )}
      <Button variant="outline" disabled={busy} onClick={() => onSave(draft)}>
        Save correction & validate again
      </Button>
    </details>
  );
}
function StudentImport(props: Props) {
  const [guardianOnly, setGuardianOnly] = useState(false);
  const [batch, setBatch] = useState<StudentBatch | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [confirmation, setConfirmation] = useState(""),
    [result, setResult] = useState<{ student_id: string; row_number: number }[] | null>(null),
    [resume, setResume] = useState("");
  const [recent, setRecent] = useState<{ id: string; filename: string; status: string }[]>([]);
  useEffect(() => {
    let live = true;
    void supabase
      .from("student_import_batches")
      .select("id,filename,status")
      .eq("institution_id", props.institution)
      .in("kind", ["import", "guardian_import"])
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (live && !error) setRecent(data ?? []);
      });
    return () => {
      live = false;
    };
  }, [props.institution, props.catalog]);
  function accept(b: StudentBatch) {
    setBatch(b);
    setGuardianOnly(b.kind === "guardian_import");
    setSelected(b.preview.filter((r) => r.outcome === "valid").map((r) => r.row_number));
    setConfirmation("");
    setResult(Array.isArray(b.result) ? b.result : null);
  }
  return (
    <div className="space-y-4">
      <label>
        Import type
        <select
          className={selectClass}
          aria-label="Import type"
          value={guardianOnly ? "guardians" : "students"}
          disabled={props.busy}
          onChange={(e) => {
            setGuardianOnly(e.target.value === "guardians");
            setBatch(null);
            setResult(null);
            setSelected([]);
            setConfirmation("");
          }}
        >
          <option value="students">Students with optional guardian</option>
          <option value="guardians">Guardian relationships for existing students</option>
        </select>
      </label>
      <p>
        Upload → local parsing → database validation and preview → corrections → explicit
        confirmation. Only selected valid rows are committed.
      </p>
      <p>
        CSV / Excel .xlsx, at most 4 MiB and 500 rows. Use Text cells for admission/roll
        identifiers. The first Excel worksheet is used; formulas and external links are rejected.
      </p>
      <Button
        variant="outline"
        onClick={() => {
          const u = URL.createObjectURL(
            new Blob(
              [
                (guardianOnly ? guardianRelationshipColumns : studentImportColumns).join(",") +
                  "\n",
              ],
              { type: "text/csv" },
            ),
          );
          const a = document.createElement("a");
          a.href = u;
          a.download = guardianOnly
            ? "guardian-relationships-template.csv"
            : "student-import-template.csv";
          a.click();
          setTimeout(() => URL.revokeObjectURL(u), 1000);
        }}
      >
        Download empty CSV template
      </Button>
      <details>
        <summary>Institution codes and term names for the template</summary>
        <ul>
          {props.catalog.departments.map((d) => (
            <li key={d.id}>
              Department {d.code}: {d.name}
            </li>
          ))}
          {props.catalog.programs.map((p) => (
            <li key={p.id}>
              Program {p.code}: {p.name}
            </li>
          ))}
          {props.catalog.cohorts.map((c) => (
            <li key={c.id}>
              Cohort {c.code}: {c.name}
            </li>
          ))}
          {props.catalog.terms.map((t) => (
            <li key={t.id}>
              {t.academic_year} / {t.name} · Year {t.year_number ?? "not numbered"} · {t.starts_on}{" "}
              — {t.ends_on}
            </li>
          ))}
        </ul>
      </details>
      <label>
        Student file
        <Input
          aria-label="Student import file"
          type="file"
          accept=".csv,.xlsx"
          disabled={props.busy || props.reason.trim().length < 10}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void props.act(async () => {
                if (file.size > 4 * 1024 * 1024) throw new Error("File exceeds 4 MiB.");
                const bytes = new Uint8Array(await file.arrayBuffer());
                const rows = await parseStudentFile(file.name, bytes, guardianOnly);
                accept(
                  await academicRpc<StudentBatch>(
                    guardianOnly ? "stage_guardian_relationship_import" : "stage_student_import",
                    {
                      p_institution: props.institution,
                      p_filename: file.name,
                      p_sha256: await studentFileHash(bytes),
                      p_rows: rows,
                      p_reason: props.reason,
                    },
                  ),
                );
              });
          }}
        />
      </label>
      {!!recent.length && (
        <div>
          <label>
            Resume recent import
            <select
              aria-label="Resume import"
              className={selectClass}
              value={resume}
              onChange={(e) => setResume(e.target.value)}
            >
              <option value="">Select your import batch</option>
              {recent.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.filename} · {b.status}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={!resume || props.busy}
            onClick={() =>
              void props.act(async () => accept(await loadStudentBatch(resume, props.institution)))
            }
          >
            Load preview
          </Button>
        </div>
      )}
      {batch && (
        <Card>
          <CardHeader>
            <CardTitle>Import preview — {batch.filename}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PreviewSummary batch={batch} />
            {batch.preview.map((r) => (
              <div key={r.row_number}>
                {batch.status === "preview" && r.outcome === "valid" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.row_number)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, r.row_number]
                            : s.filter((n) => n !== r.row_number),
                        )
                      }
                    />
                    Include row {r.row_number}
                  </label>
                )}
                {batch.status === "preview" ? (
                  <ImportRowEditor
                    key={`${r.row_number}-${batch.revision}`}
                    row={r}
                    guardianOnly={batch.kind === "guardian_import"}
                    busy={props.busy || props.reason.trim().length < 10}
                    onSave={(row) =>
                      void props.act(async () => {
                        const rows = [...batch.rows];
                        rows[r.row_number - 1] = row;
                        accept(
                          await academicRpc<StudentBatch>(
                            batch.kind === "guardian_import"
                              ? "revise_guardian_relationship_import"
                              : "revise_student_import",
                            {
                              p_batch: batch.id,
                              p_revision: batch.revision,
                              p_rows: rows,
                              p_reason: props.reason,
                            },
                          ),
                        );
                      })
                    }
                  />
                ) : (
                  <p>
                    Row {r.row_number}: {r.outcome}
                  </p>
                )}
              </div>
            ))}
            {batch.status === "preview" && (
              <>
                <label>
                  Type IMPORT followed by the selected row count
                  <Input
                    aria-label="Import confirmation"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <Button
                  disabled={
                    props.busy ||
                    props.reason.trim().length < 10 ||
                    !selected.length ||
                    confirmation !== `IMPORT ${selected.length}`
                  }
                  onClick={() =>
                    void props.act(async () => {
                      setResult(
                        await academicRpc(
                          batch.kind === "guardian_import"
                            ? "commit_guardian_relationship_import"
                            : "commit_student_import",
                          {
                            p_batch: batch.id,
                            p_revision: batch.revision,
                            p_selected: selected,
                            p_confirmation: confirmation,
                            p_reason: props.reason,
                          },
                        ),
                      );
                      setBatch({ ...batch, status: "committed" });
                    })
                  }
                >
                  Commit {selected.length} selected valid rows
                </Button>
              </>
            )}
            {result && (
              <div role="status">
                <p>
                  Imported {result.length}{" "}
                  {batch.kind === "guardian_import"
                    ? "guardian relationships."
                    : "reviewed identities/placements."}
                </p>
                <ul>
                  {result.map((r) => (
                    <li key={r.row_number}>
                      Row {r.row_number} · Student {r.student_id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function Promotion(props: Props) {
  const [cohort, setCohort] = useState(""),
    [term, setTerm] = useState(""),
    [students, setStudents] = useState<AcademicStudent[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [actions, setActions] = useState<Record<string, string>>({}),
    [overrides, setOverrides] = useState<
      Record<string, { section_id: string; cohort_id: string; starts_on: string }>
    >({});
  const [target, setTarget] = useState({ section_id: "", cohort_id: "", starts_on: "" }),
    [batch, setBatch] = useState<StudentBatch | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [more, setMore] = useState(false);
  const invalidate = () => {
    setBatch(null);
    setConfirmation("");
  };
  const count = batch?.preview.filter((r) => r.outcome === "valid").length ?? 0;
  return (
    <div className="space-y-4">
      <p>
        Select an actual source cohort and term. Choose individuals and exceptions; no year is
        inferred from cohort dates.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          Source cohort
          <select
            className={selectClass}
            aria-label="Promotion source cohort"
            value={cohort}
            onChange={(e) => {
              setCohort(e.target.value);
              setStudents([]);
              invalidate();
            }}
          >
            <option value="">Select cohort</option>
            {props.catalog.cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source term
          <select
            className={selectClass}
            aria-label="Promotion source term"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setStudents([]);
              invalidate();
            }}
          >
            <option value="">Select term</option>
            {props.catalog.terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.academic_year} / {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Button
        variant="outline"
        disabled={!cohort || !term || props.busy}
        onClick={() =>
          void props.act(async () => {
            let all: AcademicStudent[] = [];
            for (let offset = 0; offset < 500; offset += 100) {
              const page = await academicDirectory(props.institution, "", cohort, offset, term);
              all = all.concat(page.slice(0, 100));
              if (page.length <= 100) {
                setMore(false);
                break;
              }
              setMore(offset === 400);
            }
            setStudents(all);
            setSelected(all.map((s) => s.id));
            setActions({});
            setOverrides({});
            invalidate();
          })
        }
      >
        Load cohort students
      </Button>
      {more && (
        <p>
          More students remain. This reviewed batch contains the first 500. After applying it,
          reload the source term to process the remaining students.
        </p>
      )}
      {!!students.length && (
        <>
          <TargetFields
            catalog={props.catalog}
            value={target}
            onChange={(v) => {
              setTarget(v);
              invalidate();
            }}
          />
          <ul className="space-y-3">
            {students.map((s) => (
              <li className="rounded border p-3" key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) => {
                      setSelected((ids) =>
                        e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                      );
                      invalidate();
                    }}
                  />{" "}
                  {s.name} · {s.admission_number} · {s.section_name}
                </label>
                <select
                  aria-label={`Promotion action ${s.id}`}
                  className={selectClass}
                  value={actions[s.id] ?? "promote"}
                  onChange={(e) => {
                    setActions((a) => ({ ...a, [s.id]: e.target.value }));
                    invalidate();
                  }}
                >
                  {["promote", "repeat", "exclude", "break"].map((v) => (
                    <option key={v} value={v}>
                      {v === "break" ? "Academic break" : v === "repeat" ? "Detained / repeat" : v}
                    </option>
                  ))}
                </select>
                <details>
                  <summary>Individual placement exception</summary>
                  <TargetFields
                    catalog={props.catalog}
                    value={overrides[s.id] ?? target}
                    onChange={(v) => {
                      setOverrides((o) => ({ ...o, [s.id]: v }));
                      invalidate();
                    }}
                  />
                </details>
              </li>
            ))}
          </ul>
          <Button
            disabled={props.busy || !selected.length || props.reason.trim().length < 10}
            onClick={() =>
              void props.act(async () => {
                const rows = students
                  .filter((s) => selected.includes(s.id))
                  .map((s) => ({
                    student_id: s.id,
                    action: actions[s.id] ?? "promote",
                    ...(overrides[s.id] ?? target),
                  }));
                setBatch(
                  await academicRpc<StudentBatch>("stage_student_promotion", {
                    p_institution: props.institution,
                    p_rows: rows,
                    p_reason: props.reason,
                  }),
                );
                setConfirmation("");
              })
            }
          >
            Preview promotion
          </Button>
        </>
      )}
      {batch && (
        <Card>
          <CardHeader>
            <CardTitle>Promotion preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PreviewSummary batch={batch} />
            <ul>
              {batch.preview.map((r) => (
                <li key={r.row_number}>
                  {r.name} · {String(r.data.action)} · {r.outcome}
                  {r.errors.map((e, i) => (
                    <p role="alert" key={i}>
                      {e}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            <label>
              Type PROMOTE followed by the valid row count
              <Input
                aria-label="Promotion confirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <Button
              disabled={
                props.busy ||
                batch.status !== "preview" ||
                props.reason.trim().length < 10 ||
                !count ||
                batch.preview.some((r) => r.outcome === "rejected") ||
                confirmation !== `PROMOTE ${count}`
              }
              onClick={() =>
                void props.act(async () => {
                  await academicRpc("commit_student_promotion", {
                    p_batch: batch.id,
                    p_revision: batch.revision,
                    p_confirmation: confirmation,
                    p_reason: props.reason,
                  });
                  setBatch({ ...batch, status: "committed" });
                })
              }
            >
              Apply reviewed promotion
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
