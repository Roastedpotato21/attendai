import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/components/auth/auth-context";
import { staffWorkspace, setupMemberships } from "@/lib/services/staff-setup";
import { roleLabels, type StaffWorkspace } from "@/lib/staff-setup";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PeriodSummary } from "@/components/attendance/period-summary";
export function StaffWorkspacePage() {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<StaffWorkspace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      const memberships = await setupMemberships();
      const id = user?.institutionId ?? memberships[0]?.id;
      if (!id) throw new Error("No active staff workspace is available.");
      const data = await staffWorkspace(id);
      if (live) setWorkspace(data);
    })().catch((reason) => {
      if (live)
        setError(reason instanceof Error ? reason.message : "Staff profile could not be loaded.");
    });
    return () => {
      live = false;
    };
  }, [user?.institutionId]);
  if (error)
    return (
      <p role="alert" className="p-6">
        {error}
      </p>
    );
  if (!workspace) return <p className="p-6">Loading your staff workspace…</p>;
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: workspace.institution.timezone ?? "Asia/Kolkata",
    }).format(new Date()),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const staff = workspace.staff;
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4">
      <header className="space-y-2">
        {workspace.institution.logo_data_url && (
          <img
            src={workspace.institution.logo_data_url}
            alt="Institution logo"
            className="h-14 w-14 object-contain"
          />
        )}
        <p
          className="font-medium"
          style={{ color: workspace.institution.brand_color ?? undefined }}
        >
          {workspace.institution.brand_name || workspace.institution.name}
        </p>
        <h1 className="text-2xl font-semibold">
          {greeting}, {staff?.full_name ?? user?.name}
        </h1>
        <p>{workspace.primary_department ?? workspace.institution.name}</p>
        {workspace.memberships.length > 1 && (
          <label className="block">
            Institution
            <select
              aria-label="Active institution"
              className="ml-2 rounded border bg-background p-2"
              value={workspace.institution.institution_id}
              onChange={(e) => {
                localStorage.setItem("attendai:selected-institution", e.target.value);
                window.location.assign("/");
              }}
            >
              {workspace.memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <PeriodSummary institution={workspace.institution.institution_id} />
      <Card>
        <CardHeader>
          <CardTitle>Your staff profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>{staff?.designation ?? "Institution administrator"}</p>
          <p>{staff?.email ?? user?.email}</p>
          {staff?.staff_code && <p>Staff ID: {staff.staff_code}</p>}
          <p>Active roles: {workspace.roles.map((role) => roleLabels[role] ?? role).join(", ")}</p>
          <p>Primary department: {workspace.primary_department ?? "Not assigned"}</p>
          <Link to="/students" className="block underline">
            Student academic records in your scope
          </Link>
          <Link to="/institution-verification" className="block underline">
            Authority review / emergency ownership recovery
          </Link>
        </CardContent>
      </Card>
      {workspace.can_manage_setup && (
        <Card>
          <CardHeader>
            <CardTitle>Institution setup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/institution-profile">Institution profile</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/departments">Departments</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/programs">Programs & structure</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/staff">Staff</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/staff-assignments">Roles & assignments</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      <section className="space-y-3">
        {!!workspace.legacy_classes?.length && (
          <Card>
            <CardHeader>
              <CardTitle>Existing class assignments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>
                These class mappings were already recorded. Subject and term mapping still needs
                administrator review.
              </p>
              <ul>
                {workspace.legacy_classes.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
              <Link to="/attendance" className="underline">
                Open assigned class attendance
              </Link>
            </CardContent>
          </Card>
        )}
        <h2 className="text-xl font-semibold">Your academic responsibilities</h2>
        {!workspace.assignments.length && (
          <p>No current academic responsibilities have been assigned.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {workspace.assignments.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle>
                  {a.kind === "teaching"
                    ? "Subject faculty"
                    : a.kind === "department_member"
                      ? "Additional department"
                      : (roleLabels[a.kind] ?? a.kind)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p>{a.department_name}</p>
                {a.program_name && <p>{a.program_name}</p>}
                {(a.term_name || a.academic_year) && (
                  <p>
                    {a.term_name} · {a.academic_year}
                  </p>
                )}
                {a.subject_name && <p>Subject: {a.subject_name}</p>}
                {a.section_name && <p>Section: {a.section_name}</p>}
                <p className="text-sm">
                  {a.effective_from} — {a.effective_until}
                </p>
                {!a.role_effective && <p>Awaiting the corresponding system role.</p>}
                {"program_count" in a && a.program_count != null && (
                  <p>Programs in your department: {String(a.program_count)}</p>
                )}
                {"section_count" in a && a.section_count != null && (
                  <p>Sections in your scope: {String(a.section_count)}</p>
                )}
                {a.can_mark_subject && (
                  <p className="text-sm">
                    Your subject permission is valid for this assignment. Attendance entry will use
                    a subject-specific session flow.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
