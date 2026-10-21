import { useEffect, useState } from "react";
import type { SetupActions } from "./institution-setup";
import {
  setupRoles,
  roleLabels,
  institutionDay,
  currentRoleGrant,
  emptyStaff,
  type StaffDetails,
  type ResponsibilityDraft,
  type ResponsibilityKind,
  type SetupCatalog,
} from "@/lib/staff-setup";
import { setupRpc, generateStaffInvitation } from "@/lib/services/staff-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StaffLifecyclePanel } from "./staff-lifecycle";
import { useAuth } from "@/components/auth/auth-context";
type RoleSelection = string[];
function Roles({ value, onChange }: { value: RoleSelection; onChange: (roles: string[]) => void }) {
  const { user } = useAuth();
  const canAssignAdmin = user?.setupRoles?.includes("institution_owner") === true;
  return (
    <fieldset className="grid gap-2 md:grid-cols-2">
      <legend className="mb-2 font-medium">System roles</legend>
      {setupRoles.map((role) => (
        <label key={role} className="flex gap-2">
          <input
            type="checkbox"
            checked={value.includes(role)}
            disabled={role === "institution_admin" && !canAssignAdmin}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))
            }
          />
          {roleLabels[role]}
        </label>
      ))}
    </fieldset>
  );
}
function PersonalFields({
  value,
  onChange,
  departmentOnly = false,
  designationOnly = false,
  emailLocked = false,
  prefix = "staff",
}: {
  value: StaffDetails;
  onChange: (d: StaffDetails) => void;
  departmentOnly?: boolean;
  designationOnly?: boolean;
  emailLocked?: boolean;
  prefix?: string;
}) {
  const field = (key: keyof StaffDetails, label: string, type = "text", required = true) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={prefix + "-" + key}>{label}</Label>
      <Input
        id={prefix + "-" + key}
        type={type}
        value={value[key]}
        required={required}
        readOnly={key === "email" && emailLocked}
        maxLength={key === "email" ? 254 : 120}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );
  if (departmentOnly) return null;
  if (designationOnly)
    return (
      <>
        {field("designation", "Designation")}
        <datalist id="designation-examples">
          {[
            "Professor",
            "Associate Professor",
            "Assistant Professor",
            "Lecturer",
            "HOD",
            "Coordinator",
            "Administrative Staff",
          ].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </datalist>
        <p className="text-sm">Designation describes the job. It does not grant permissions.</p>
      </>
    );
  return (
    <>
      {field("full_name", "Full name")}
      {field("email", "Email", "email")}
      {field("phone", "Phone", "tel", false)}
      {field("staff_code", "Employee / staff ID", "text", !emailLocked)}
    </>
  );
}
function DepartmentChoice({
  catalog,
  value,
  onChange,
}: {
  catalog: SetupCatalog;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="block space-y-1">
      Primary department
      <select
        aria-label="Primary department"
        className="block w-full rounded border bg-background p-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No primary department</option>
        {catalog.departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
const emptyAssignment: ResponsibilityDraft = {
  kind: "teaching",
  department_id: "",
  program_id: "",
  term_id: "",
  section_id: "",
  subject_id: "",
  academic_year: "",
  effective_from: "",
  effective_until: "",
  reason: "",
};
export function AssignmentBuilder({
  catalog,
  busy,
  onAdd,
}: {
  catalog: SetupCatalog;
  busy: boolean;
  onAdd: (a: ResponsibilityDraft) => void;
}) {
  const [draft, setDraft] = useState<ResponsibilityDraft>({ ...emptyAssignment });
  const departmentOnly = draft.kind === "department_member" || draft.kind === "hod";
  const set = (key: keyof ResponsibilityDraft, value: string) =>
    setDraft((d) => {
      if (key === "program_id") {
        const p = catalog.programs.find((p) => p.id === value);
        return {
          ...d,
          program_id: value,
          department_id: p?.department_id ?? "",
          term_id: "",
          section_id: "",
          subject_id: "",
          academic_year: "",
        };
      }
      if (key === "term_id") {
        const t = catalog.terms.find((t) => t.id === value);
        return {
          ...d,
          term_id: value,
          section_id: "",
          academic_year: t?.academic_year ?? "",
          effective_from: t?.starts_on ?? "",
          effective_until: t?.ends_on ?? "",
        };
      }
      return { ...d, [key]: value };
    });
  const select = (
    key: keyof ResponsibilityDraft,
    label: string,
    options: { id: string; name: string }[],
    required = true,
  ) => (
    <label className="block space-y-1" key={key}>
      {label}
      <select
        aria-label={label}
        className="block w-full rounded border bg-background p-2"
        value={draft[key]}
        required={required}
        onChange={(e) => set(key, e.target.value)}
      >
        <option value="">{required ? "Select" : "Whole program / no term"}</option>
        {options.map((o) => (
          <option value={o.id} key={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      className="grid gap-3 rounded border p-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ ...draft });
      }}
    >
      <fieldset disabled={busy} className="contents">
        <label>
          Responsibility
          <select
            aria-label="Responsibility type"
            className="block w-full rounded border bg-background p-2"
            value={draft.kind}
            onChange={(e) =>
              setDraft({ ...emptyAssignment, kind: e.target.value as ResponsibilityKind })
            }
          >
            {(
              ["teaching", "class_incharge", "hod", "coordinator", "department_member"] as const
            ).map((k) => (
              <option key={k} value={k}>
                {k === "teaching"
                  ? "Subject faculty"
                  : k === "department_member"
                    ? "Additional department membership"
                    : roleLabels[k]}
              </option>
            ))}
          </select>
        </label>
        {departmentOnly
          ? select("department_id", "Responsibility department", catalog.departments)
          : select(
              "program_id",
              "Responsibility program",
              catalog.programs.map((p) => ({
                ...p,
                name:
                  p.name +
                  " · " +
                  (catalog.departments.find((d) => d.id === p.department_id)?.name ?? ""),
              })),
            )}
        {!departmentOnly &&
          select(
            "term_id",
            "Responsibility term",
            catalog.terms
              .filter((t) => t.program_id === draft.program_id)
              .map((t) => ({ ...t, name: t.name + " · " + t.academic_year })),
            draft.kind !== "coordinator",
          )}
        {(draft.kind === "teaching" || draft.kind === "class_incharge") &&
          select(
            "section_id",
            "Responsibility section",
            catalog.sections.filter((s) => s.term_id === draft.term_id),
          )}
        {draft.kind === "teaching" &&
          select(
            "subject_id",
            "Teaching subject",
            catalog.subjects.filter((s) => s.program_id === draft.program_id),
          )}
        <label>
          Academic year
          <Input
            aria-label="Responsibility academic year"
            value={draft.academic_year}
            required={draft.kind === "class_incharge"}
            maxLength={80}
            onChange={(e) => set("academic_year", e.target.value)}
          />
        </label>
        <label>
          Effective from
          <Input
            aria-label="Assignment effective from"
            type="date"
            required
            value={draft.effective_from}
            onChange={(e) => set("effective_from", e.target.value)}
          />
        </label>
        <label>
          Effective until
          <Input
            aria-label="Assignment effective until"
            type="date"
            min={draft.effective_from || undefined}
            required
            value={draft.effective_until}
            onChange={(e) => set("effective_until", e.target.value)}
          />
        </label>
        <label className="md:col-span-2">
          Assignment reason
          <Input
            aria-label="Assignment reason"
            value={draft.reason}
            required
            minLength={10}
            maxLength={1000}
            onChange={(e) => set("reason", e.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          Add responsibility
        </Button>
      </fieldset>
    </form>
  );
}
function PrivateInvitation({ link }: { link: string }) {
  return (
    <div role="status" className="space-y-2 rounded border p-3">
      <strong>Invitation link generated — no email sent</strong>
      <p>
        Share this private link with the intended staff member using a trusted channel. The
        invitation expires after seven days; the account-verification link can expire sooner.
      </p>
      <textarea
        className="w-full rounded border bg-background p-2 text-xs"
        aria-label="Private invitation link"
        readOnly
        value={link}
      />
      <p className="text-sm">
        The link is shown for this session only. Generating a replacement invalidates the previous
        institution invitation.
      </p>
    </div>
  );
}
function StaffWizard({
  id,
  catalog,
  busy,
  act,
  onCreated,
}: {
  id: string;
  catalog: SetupCatalog;
  busy: boolean;
  act: SetupActions["act"];
  onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [details, setDetails] = useState<StaffDetails>({ ...emptyStaff });
  const [roles, setRoles] = useState<string[]>(["faculty"]);
  const [assignments, setAssignments] = useState<ResponsibilityDraft[]>([]);
  const [created, setCreated] = useState("");
  const [link, setLink] = useState("");
  const steps = [
    "Personal details",
    "Department",
    "Designation",
    "Roles",
    "Subject/class assignments",
    "Review & invite",
  ];
  async function invite() {
    let staffId = created;
    if (!staffId) {
      staffId = await setupRpc<string>("create_staff_record", {
        p_institution: id,
        p_details: details,
        p_roles: roles,
        p_assignments: assignments,
      });
      setCreated(staffId);
      onCreated(staffId);
    }
    const result = await generateStaffInvitation(staffId);
    setLink(result.invitationLink);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Add staff — Step {step}: {steps[step - 1]}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol aria-label="Staff creation progress" className="flex flex-wrap gap-2 text-xs">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={step === i + 1 ? "step" : undefined}
              className={step === i + 1 ? "font-bold" : ""}
            >
              {i + 1}. {s}
            </li>
          ))}
        </ol>
        {step === 5 ? (
          <>
            <p>
              A person can teach across departments without a duplicate staff record. Each
              responsibility needs an explicit scope and dates.
            </p>
            <AssignmentBuilder
              catalog={catalog}
              busy={busy}
              onAdd={(a) => setAssignments((all) => [...all, a])}
            />
            <ul className="space-y-2">
              {assignments.map((a, i) => (
                <li key={i} className="flex justify-between rounded border p-2">
                  {a.kind.replaceAll("_", " ")} · {a.academic_year} · {a.effective_from} —{" "}
                  {a.effective_until}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAssignments((all) => all.filter((_, index) => index !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" onClick={() => setStep(6)}>
              Review staff invitation
            </Button>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 6) setStep(step + 1);
              else void act(invite);
            }}
          >
            <fieldset disabled={busy || !!created} className="space-y-3">
              {step === 1 && <PersonalFields value={details} onChange={setDetails} />}
              {step === 2 && (
                <>
                  <DepartmentChoice
                    catalog={catalog}
                    value={details.primary_department_id}
                    onChange={(value) =>
                      setDetails((d) => ({ ...d, primary_department_id: value }))
                    }
                  />
                  <p className="text-sm">
                    Additional department memberships and teaching scopes are separate dated
                    assignments.
                  </p>
                </>
              )}
              {step === 3 && (
                <PersonalFields value={details} onChange={setDetails} designationOnly />
              )}
              {step === 4 && (
                <>
                  <Roles value={roles} onChange={setRoles} />
                  {!roles.length && <p>Select at least one role.</p>}
                  <p>
                    HOD and Class Incharge roles require corresponding scoped responsibilities. A
                    designation grants no access.
                  </p>
                </>
              )}
              {step === 6 && (
                <dl className="space-y-2">
                  <dt>Name</dt>
                  <dd>{details.full_name}</dd>
                  <dt>Email / Staff ID</dt>
                  <dd>
                    {details.email} · {details.staff_code}
                  </dd>
                  <dt>Department</dt>
                  <dd>
                    {catalog.departments.find((d) => d.id === details.primary_department_id)
                      ?.name ?? "No primary department"}
                  </dd>
                  <dt>Designation</dt>
                  <dd>{details.designation}</dd>
                  <dt>Roles</dt>
                  <dd>{roles.map((r) => roleLabels[r]).join(", ")}</dd>
                  <dt>Responsibilities</dt>
                  <dd>{assignments.length} explicitly scoped assignments</dd>
                </dl>
              )}
            </fieldset>
            <Button type="submit" disabled={busy || (step === 4 && !roles.length) || !!link}>
              {step === 6
                ? created
                  ? "Retry invitation generation"
                  : "Create staff & generate invitation"
                : "Continue"}
            </Button>
          </form>
        )}
        {step > 1 && !created && (
          <Button variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {created && !link && (
          <p>
            The staff record is saved but not active. Generate or retry its invitation to continue.
          </p>
        )}
        {link && <PrivateInvitation link={link} />}
      </CardContent>
    </Card>
  );
}
export function StaffManager({
  id,
  catalog,
  profile,
  busy,
  act,
  assignmentsOnly,
}: SetupActions & { assignmentsOnly: boolean }) {
  const [selected, setSelected] = useState("");
  const [wizard, setWizard] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [details, setDetails] = useState<StaffDetails>({ ...emptyStaff });
  const [reason, setReason] = useState("");
  const [link, setLink] = useState("");
  const staff = catalog.staff.find((s) => s.id === selected);
  const today = institutionDay(profile.timezone ?? "Asia/Kolkata");
  useEffect(() => {
    if (!staff) return;
    setDetails({
      full_name: staff.full_name,
      email: staff.email,
      phone: staff.phone,
      staff_code: staff.staff_code ?? "",
      primary_department_id: staff.primary_department_id ?? "",
      designation: staff.designation,
    });
    setRoles(catalog.roles.filter((r) => r.staff_id === staff.id && r.active).map((r) => r.role));
  }, [staff, catalog.roles]);
  const name = (
    id: string | null,
    type: "departments" | "programs" | "terms" | "sections" | "subjects",
  ) => catalog[type].find((e) => e.id === id)?.name ?? "";
  return (
    <div className="space-y-5">
      {!assignmentsOnly && (
        <Button disabled={busy} onClick={() => setWizard((open) => !open)}>
          {wizard ? "Close new staff form" : "Add staff"}
        </Button>
      )}
      {wizard && !assignmentsOnly && (
        <StaffWizard id={id} catalog={catalog} busy={busy} act={act} onCreated={setSelected} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            {assignmentsOnly ? "Select staff for roles & responsibilities" : "Staff directory"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {catalog.staff.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="w-full rounded border p-3 text-left"
                  onClick={() => {
                    setSelected(s.id);
                    setReason("");
                    setLink("");
                  }}
                >
                  <strong>{s.full_name}</strong> · {s.designation}
                  <span className="block text-sm">
                    {s.email} · {s.staff_code ?? "Staff ID not recorded"} ·{" "}
                    {name(s.primary_department_id, "departments") || "No primary department"} ·{" "}
                    {s.status}
                  </span>
                  <span className="block text-sm">
                    {[
                      profile.owner_profile_id && s.profile_id === profile.owner_profile_id
                        ? "Institution Owner"
                        : "",
                      ...catalog.roles
                        .filter((r) => r.staff_id === s.id && currentRoleGrant(r, today))
                        .map((r) => roleLabels[r.role]),
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!catalog.staff.length && <p>No staff records configured.</p>}
        </CardContent>
      </Card>
      {staff && (
        <Card>
          <CardHeader>
            <CardTitle>{staff.full_name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p>
              Status: {staff.status}. Membership is activated only after verified invitation
              acceptance.
            </p>
            {!assignmentsOnly && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() =>
                    setupRpc("update_staff_record", {
                      p_staff: staff.id,
                      p_details: details,
                      p_reason: reason,
                    }),
                  );
                }}
              >
                <fieldset disabled={busy} className="space-y-3">
                  <PersonalFields
                    value={details}
                    onChange={setDetails}
                    emailLocked
                    prefix="edit-staff"
                  />
                  <PersonalFields
                    value={details}
                    onChange={setDetails}
                    designationOnly
                    prefix="edit-staff"
                  />
                  <DepartmentChoice
                    catalog={catalog}
                    value={details.primary_department_id}
                    onChange={(value) =>
                      setDetails((d) => ({ ...d, primary_department_id: value }))
                    }
                  />
                  <label>
                    Profile change reason
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      minLength={10}
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    Save staff profile
                  </Button>
                </fieldset>
              </form>
            )}
            <div className="space-y-3">
              <Roles value={roles} onChange={setRoles} />
              <label>
                Role/assignment change reason
                <Input
                  aria-label="Role or assignment change reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                />
              </label>
              <Button
                disabled={busy || !roles.length || reason.trim().length < 10}
                onClick={() =>
                  void act(() =>
                    setupRpc("set_staff_roles", {
                      p_staff: staff.id,
                      p_roles: roles,
                      p_reason: reason,
                    }),
                  )
                }
              >
                Save roles
              </Button>
            </div>
            {["draft", "invited"].includes(staff.status) && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await generateStaffInvitation(staff.id);
                      setLink(result.invitationLink);
                    })
                  }
                >
                  Generate private invitation link
                </Button>
                {link && <PrivateInvitation link={link} />}
              </div>
            )}
            <h3 className="font-semibold">Add academic responsibility</h3>
            <AssignmentBuilder
              catalog={catalog}
              busy={busy}
              onAdd={(assignment) =>
                void act(() =>
                  setupRpc("add_staff_responsibility", {
                    p_staff: staff.id,
                    p_details: assignment,
                  }),
                )
              }
            />
            <h3 className="font-semibold">Responsibility history</h3>
            <ul className="space-y-2">
              {catalog.responsibilities
                .filter((a) => a.staff_id === staff.id)
                .map((a) => (
                  <li className="rounded border p-3" key={a.id}>
                    <strong>{a.kind.replaceAll("_", " ")}</strong> ·{" "}
                    {name(a.department_id, "departments")} · {name(a.program_id, "programs")} ·{" "}
                    {name(a.term_id, "terms")} · {name(a.section_id, "sections")} ·{" "}
                    {name(a.subject_id, "subjects")}
                    <p>
                      {a.academic_year} · {a.effective_from} — {a.effective_until} ·{" "}
                      {a.active ? "active" : "closed"}
                      {a.ended_on ? ` · actual end ${a.ended_on}` : ""}
                    </p>
                    <p className="text-sm">{a.reason}</p>
                    {a.end_reason && <p className="text-sm">Closure: {a.end_reason}</p>}
                    {a.active && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || reason.trim().length < 10}
                        onClick={() =>
                          void act(() =>
                            setupRpc("close_staff_responsibility", {
                              p_id: a.id,
                              p_reason: reason,
                            }),
                          )
                        }
                      >
                        End this responsibility
                      </Button>
                    )}
                  </li>
                ))}
            </ul>
            <details>
              <summary>Role history</summary>
              <ul className="space-y-1">
                {catalog.roles
                  .filter((r) => r.staff_id === staff.id)
                  .map((r) => (
                    <li key={r.id}>
                      {roleLabels[r.role]} · {r.valid_from} — {r.valid_until ?? "open ended"} ·{" "}
                      {r.ended_on ? `actual end ${r.ended_on} · ` : ""}
                      {!r.active
                        ? "closed"
                        : currentRoleGrant(r, today)
                          ? "current"
                          : r.valid_from > today
                            ? "scheduled"
                            : "expired"}{" "}
                      · {r.reason}
                    </li>
                  ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      )}
      <StaffLifecyclePanel
        key={selected || "institution"}
        id={id}
        catalog={catalog}
        profile={profile}
        busy={busy}
        act={act}
        staff={staff}
      />
    </div>
  );
}
