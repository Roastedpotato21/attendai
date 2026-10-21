import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/auth-context";
import {
  setupMemberships,
  setupProfile,
  setupCatalog,
  setupRpc,
  saveLogo,
} from "@/lib/services/staff-setup";
import type { InstitutionProfile, Membership, SetupCatalog } from "@/lib/staff-setup";
import { StaffManager } from "./staff-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
export type SetupSection = "profile" | "departments" | "programs" | "staff" | "assignments";
export type SetupActions = {
  id: string;
  catalog: SetupCatalog;
  profile: InstitutionProfile;
  busy: boolean;
  act: (work: () => Promise<void>) => Promise<void>;
};
const links = [
  ["/institution-profile", "Institution Profile"],
  ["/departments", "Departments"],
  ["/programs", "Programs"],
  ["/staff", "Staff"],
  ["/staff-assignments", "Roles & Assignments"],
] as const;
export function InstitutionSetupPage({ section }: { section: SetupSection }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [id, setId] = useState("");
  const [model, setModel] = useState<{ profile: InstitutionProfile; catalog: SetupCatalog } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const invalidate = useCallback(() => {
    sequence.current++;
  }, []);
  useEffect(() => {
    let live = true;
    void setupMemberships()
      .then((all) => {
        if (!live) return;
        const allowed = all.filter((m) => m.can_manage);
        setMembers(allowed);
        setId(allowed.find((m) => m.id === user?.institutionId)?.id ?? allowed[0]?.id ?? "");
      })
      .catch(() => {
        if (live) {
          setMembers([]);
          setError("Institution setup access could not be verified.");
        }
      });
    return () => {
      live = false;
    };
  }, [user?.institutionId]);
  const refresh = useCallback(async () => {
    if (!id) return;
    const request = ++sequence.current;
    const [profile, catalog] = await Promise.all([setupProfile(id), setupCatalog(id)]);
    if (request === sequence.current) setModel({ profile, catalog });
  }, [id]);
  useEffect(() => {
    setModel(null);
    setNotice("");
    setError("");
    void refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Setup could not be loaded."),
    );
    return invalidate;
  }, [refresh, invalidate]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
      setNotice("Changes saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Setup action failed.");
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (members === null) return <p className="p-6">Checking institution setup access…</p>;
  if (!members.length)
    return (
      <main className="p-6 space-y-3">
        <h1 className="text-xl font-semibold">Institution owner/admin access required</h1>
        <p>{error || "Staff cannot manage institution setup or claim membership."}</p>
        <Link to="/dashboard">Go to your dashboard</Link>
      </main>
    );
  const props = model ? { id, catalog: model.catalog, profile: model.profile, busy, act } : null;
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">
          {links.find(
            (l) =>
              l[0] ===
              (section === "profile"
                ? "/institution-profile"
                : section === "assignments"
                  ? "/staff-assignments"
                  : "/" + section),
          )?.[1] ?? "Institution setup"}
        </h1>
        <Label htmlFor="setup-institution">Institution</Label>
        <select
          id="setup-institution"
          className="block rounded border bg-background p-2"
          value={id}
          disabled={busy}
          onChange={(e) => setId(e.target.value)}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <nav className="flex flex-wrap gap-3" aria-label="Institution setup">
          {links.map(([to, label]) => (
            <Link key={to} to={to} className="text-sm underline">
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
      {!props ? (
        <p>Loading institution setup…</p>
      ) : (
        <div key={id}>
          {section === "profile" ? (
            <InstitutionForm {...props} />
          ) : section === "staff" || section === "assignments" ? (
            <StaffManager {...props} assignmentsOnly={section === "assignments"} />
          ) : (
            <AcademicSetup {...props} departmentsOnly={section === "departments"} />
          )}
        </div>
      )}
      {model && (
        <details className="border-t pt-3">
          <summary>Recent setup audit history</summary>
          <p className="text-sm">Latest 100 changes. Full history is retained in Supabase.</p>
          <ul className="space-y-1 text-sm">
            {model.catalog.audit.map((a) => (
              <li key={a.id}>
                {new Date(a.created_at).toLocaleString()} · {a.entity_type} · {a.action} · actor{" "}
                {a.actor_profile_id ?? "system/database"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
function InstitutionForm({ id, profile, busy, act }: SetupActions) {
  const [details, setDetails] = useState({
    ...profile,
    official_address: profile.official_address ?? "",
    city: profile.city ?? "",
    academic_year: profile.academic_year ?? "",
    timezone: profile.timezone ?? "Asia/Kolkata",
    official_email: profile.official_email ?? "",
    official_phone: profile.official_phone ?? "",
    website: profile.website ?? "",
    brand_name: profile.brand_name ?? "",
    brand_color: profile.brand_color ?? "#2563eb",
  });
  useEffect(() => {
    setDetails({
      ...profile,
      official_address: profile.official_address ?? "",
      city: profile.city ?? "",
      academic_year: profile.academic_year ?? "",
      timezone: profile.timezone ?? "Asia/Kolkata",
      official_email: profile.official_email ?? "",
      official_phone: profile.official_phone ?? "",
      website: profile.website ?? "",
      brand_name: profile.brand_name ?? "",
      brand_color: profile.brand_color ?? "#2563eb",
    });
  }, [profile]);
  const field = (
    key: keyof typeof details,
    label: string,
    type = "text",
    required = true,
    readOnly = false,
  ) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        type={type}
        value={String(details[key] ?? "")}
        maxLength={key === "official_address" ? 2000 : key === "website" ? 2000 : 254}
        required={required}
        readOnly={readOnly}
        onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
      />
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Institution identity and profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p>
          The recognized institution name is fixed. Branding does not change verification identity.
        </p>
        {profile.logo_data_url && (
          <img
            src={profile.logo_data_url}
            alt="Institution logo"
            className="h-20 w-20 object-contain"
          />
        )}
        <label className="block space-y-2">
          Institution logo — PNG/JPEG, up to 256 KiB
          <Input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void act(() => saveLogo(id, file));
            }}
          />
        </label>
        {profile.logo_data_url && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(() =>
                setupRpc("set_institution_setup_logo", {
                  p_institution: id,
                  p_base64: null,
                  p_mime: null,
                }),
              )
            }
          >
            Remove logo
          </Button>
        )}
        <form
          className="grid gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              setupRpc("save_institution_setup_profile", { p_institution: id, p_details: details }),
            );
          }}
        >
          <fieldset disabled={busy} className="contents">
            {field(
              "name",
              profile.verified_identity ? "Verified institution name" : "Recorded institution name",
              "text",
              true,
              true,
            )}
            {field("institution_type", "Institution type", "text", true, profile.verified_identity)}
            {field("official_address", "Official address")}
            {field("city", "City")}
            {field("state", "State", "text", true, profile.verified_identity)}
            {field("academic_year", "Current academic year")}
            {field("timezone", "IANA timezone (for example Asia/Kolkata)")}
            {field("official_email", "Official contact email", "email")}
            {field("official_phone", "Official phone", "tel")}
            {field("website", "Official website (HTTPS)", "url", false)}
            {field("brand_name", "Brand/display name", "text", false)}
            {field("brand_color", "Brand color", "color")}
            <Button type="submit" disabled={busy}>
              Save institution profile
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
function AcademicSetup({
  id,
  catalog,
  profile,
  busy,
  act,
  departmentsOnly,
}: SetupActions & { departmentsOnly: boolean }) {
  const [kind, setKind] = useState(departmentsOnly ? "department" : "program");
  const [values, setValues] = useState<Record<string, string>>({
    name: "",
    code: "",
    department_id: "",
    program_id: "",
    term_id: "",
    academic_year: profile.academic_year ?? "",
    term_kind: "semester",
    year_number: "",
    starts_on: "",
    ends_on: "",
  });
  const input = (key: string, label: string, type = "text", required = true) => (
    <div className="space-y-1" key={key}>
      <Label htmlFor={"academic-" + key}>{label}</Label>
      <Input
        id={"academic-" + key}
        type={type}
        required={required}
        value={values[key] ?? ""}
        maxLength={160}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      />
    </div>
  );
  const select = (key: string, label: string, options: { id: string; name: string }[]) => (
    <div className="space-y-1">
      <Label htmlFor={"academic-" + key}>{label}</Label>
      <select
        id={"academic-" + key}
        className="w-full rounded border bg-background p-2"
        required
        value={values[key] ?? ""}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
  const departmentName = (key: string) => catalog.departments.find((d) => d.id === key)?.name ?? "";
  const programName = (key: string) => catalog.programs.find((p) => p.id === key)?.name ?? "";
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{departmentsOnly ? "Add department" : "Build academic structure"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await setupRpc("create_academic_entity", {
                  p_institution: id,
                  p_kind: kind,
                  p_details: values,
                });
                setValues((v) => ({ ...v, name: "", code: "" }));
              });
            }}
          >
            <fieldset disabled={busy} className="contents">
              {!departmentsOnly && (
                <label>
                  Structure type
                  <select
                    aria-label="Academic entity type"
                    className="block w-full rounded border bg-background p-2"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    {["program", "term", "section", "subject"].map((k) => (
                      <option key={k} value={k}>
                        {k === "term" ? "Year / semester / term" : k}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {kind === "program" && select("department_id", "Department", catalog.departments)}
              {(kind === "term" || kind === "subject") &&
                select(
                  "program_id",
                  "Program",
                  catalog.programs.map((p) => ({
                    ...p,
                    name: p.name + " · " + departmentName(p.department_id),
                  })),
                )}
              {kind === "section" &&
                select(
                  "term_id",
                  "Academic term",
                  catalog.terms.map((t) => ({
                    ...t,
                    name: programName(t.program_id) + " · " + t.name + " · " + t.academic_year,
                  })),
                )}
              {input("name", kind === "section" ? "Section name" : "Name")}
              {(kind === "department" || kind === "program" || kind === "subject") &&
                input("code", "Code")}
              {kind === "term" && (
                <>
                  {input("academic_year", "Academic year")}
                  <label>
                    Term kind
                    <select
                      aria-label="Term kind"
                      className="block w-full rounded border bg-background p-2"
                      value={values["term_kind"]}
                      onChange={(e) => setValues((v) => ({ ...v, term_kind: e.target.value }))}
                    >
                      {["year", "semester", "term"].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                  {input("year_number", "Year number (optional)", "number", false)}
                  {input("starts_on", "Start date", "date")}
                  {input("ends_on", "End date", "date")}
                </>
              )}
              <Button type="submit" disabled={busy}>
                Create {kind}
              </Button>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      {departmentsOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Departments</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {catalog.departments.map((d) => (
                <li className="border-b py-2" key={d.id}>
                  {d.name} · {d.code}
                </li>
              ))}
            </ul>
            {!catalog.departments.length && <p>No departments configured.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {catalog.programs.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>
                  {p.name} · {p.code}
                </CardTitle>
                <p>{departmentName(p.department_id)}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p>
                  Subjects:{" "}
                  {catalog.subjects
                    .filter((s) => s.program_id === p.id)
                    .map((s) => s.name + " (" + s.code + ")")
                    .join(", ") || "None configured"}
                </p>
                {catalog.terms
                  .filter((t) => t.program_id === p.id)
                  .map((t) => (
                    <div key={t.id} className="rounded border p-3">
                      <strong>
                        {t.name} · {t.academic_year}
                      </strong>
                      <p>
                        {t.starts_on} — {t.ends_on}
                      </p>
                      <p>
                        Sections:{" "}
                        {catalog.sections
                          .filter((s) => s.term_id === t.id)
                          .map((s) => s.name)
                          .join(", ") || "None configured"}
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}
          {!catalog.programs.length && (
            <p>
              No programs configured. Create departments first, then add your institution's
              programs, terms, sections and subjects.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
