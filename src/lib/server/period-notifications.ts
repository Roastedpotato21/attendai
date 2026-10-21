import { createClient } from "@supabase/supabase-js";

/** Called by the existing trusted worker, never by a browser or an attendance submit. */
export async function processPeriodNotifications(limit = 100): Promise<void> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("Period notification database is not configured");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.rpc("process_period_notifications", { p_limit: limit });
  if (error) throw new Error("Period notification processing failed");
}

type Fact = { subject?: unknown; period?: unknown; status?: unknown; old_status?: unknown };
const clean = (value: unknown, fallback: string, max = 65) =>
  typeof value === "string" && value.trim()
    ? value
        .replace(/\p{Cc}/gu, " ")
        .trim()
        .slice(0, max)
    : fallback;

/** English is an explicit safe fallback until reviewed translations are available. */
export function renderPeriodNotification(
  metadata: Record<string, unknown>,
  student: string,
  institution: string,
): { title: string; body: string; expiresAt: string } {
  const facts = Array.isArray(metadata["facts"]) ? (metadata["facts"] as Fact[]) : [];
  const first = facts[0] ?? {};
  const name = clean(student, "Your student", 60);
  const school = clean(institution, "the institution", 60);
  const date = clean(metadata["attendance_date"], "the recorded date", 10);
  const subject = clean(first.subject, "Recorded subject");
  const period = clean(first.period, "recorded period", 45);
  const expiresAt = typeof metadata["expires_at"] === "string" ? metadata["expires_at"] : "";
  if (metadata["kind"] === "correction") {
    const statuses: Record<string, string> = {
      present: "Present",
      absent: "Absent",
      approved_leave: "Approved Leave",
    };
    const oldStatus = statuses[String(first.old_status)] ?? "previous mark";
    const newStatus = statuses[String(first.status)] ?? "corrected mark";
    return {
      title: "Attendance Correction",
      body: `${clean(name, "Student", 40)}: ${clean(subject, "Subject", 45)}, ${clean(period, "Period", 35)}, ${date} at ${clean(school, "Institution", 45)}: ${oldStatus} → ${newStatus}. Please ignore the previous attendance notice for this period.`.slice(
        0,
        350,
      ),
      expiresAt,
    };
  }
  if (metadata["kind"] === "daily_summary") {
    const periods = facts
      .map((f) => `${clean(f.subject, "Subject", 35)} (${clean(f.period, "period", 25)})`)
      .join(", ");
    const prefix = `${name}: ${facts.length} absent period${facts.length === 1 ? "" : "s"} on ${date} at ${school}. `;
    return { title: "Daily Attendance Summary", body: (prefix + periods).slice(0, 350), expiresAt };
  }
  return {
    title: "Attendance Alert",
    body: `${name} was marked Absent for ${subject}, ${period}, on ${date} at ${school}.`.slice(
      0,
      350,
    ),
    expiresAt,
  };
}
