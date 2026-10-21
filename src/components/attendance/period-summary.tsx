import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { academicRpc } from "@/lib/services/student-academics";
import type { PeriodCatalog, PeriodSession } from "@/lib/period-attendance";
export function PeriodSummary({ institution }: { institution: string }) {
  const [rows, setRows] = useState<PeriodSession[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      const catalog = await academicRpc<PeriodCatalog>("period_timetable_catalog", {
        p_institution: institution,
      });
      const data = await academicRpc<PeriodSession[]>("period_session_directory", {
        p_institution: institution,
        p_from: catalog.today,
        p_until: catalog.today,
        p_offset: 0,
      });
      if (live) {
        setRows(data);
        setError("");
      }
    })().catch((e) => {
      if (live) setError(e instanceof Error ? e.message : "Session overview unavailable.");
    });
    return () => {
      live = false;
    };
  }, [institution]);
  return (
    <section className="space-y-2 rounded border p-4">
      <h2 className="text-lg font-semibold">Today’s sessions in your scope</h2>
      <Link className="underline" to="/period-attendance">
        Open sessions and pending register
      </Link>
      {error ? (
        <p role="alert">{error}</p>
      ) : rows ? (
        <>
          <p>
            Scheduled {rows.filter((r) => r.state === "scheduled").length} · Pending{" "}
            {rows.filter((r) => r.state === "pending").length} · Submitted / grace{" "}
            {rows.filter((r) => ["submitted", "grace_period"].includes(r.state)).length} · Locked{" "}
            {rows.filter((r) => r.state === "locked").length} · Corrected{" "}
            {rows.filter((r) => r.state === "corrected").length} · Cancelled{" "}
            {rows.filter((r) => r.state === "cancelled").length}
          </p>
          {rows.slice(0, 10).map((s) => (
            <p key={s.id}>
              {s.planned.label} · {s.planned.subject_name} · {s.state.replaceAll("_", " ")} ·
              Scheduled {s.planned.faculty_name}
              {s.substitute_name ? ` → ${s.substitute_name}` : ""} ·{" "}
              {s.actual_submitter
                ? `Submitted by ${s.actual_submitter} at ${s.submitted_at}`
                : "Not submitted"}
            </p>
          ))}
          {!rows.length && <p>No generated sessions in your scope today.</p>}
          {rows.length > 10 && <p>Open the register for the remaining sessions.</p>}
        </>
      ) : (
        <p>Loading today’s scoped sessions…</p>
      )}
    </section>
  );
}
