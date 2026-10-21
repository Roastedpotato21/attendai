export const periodStatuses = ["present", "absent", "approved_leave"] as const;
export type PeriodStatus = (typeof periodStatuses)[number];
export type PeriodState =
  "scheduled" | "pending" | "submitted" | "grace_period" | "locked" | "corrected" | "cancelled";
export type PeriodSection = {
  id: string;
  name: string;
  program_id: string;
  term_id: string;
  program_name: string;
  term_name: string;
  can_schedule: boolean;
  can_ci: boolean;
};
export type PeriodSubject = { id: string; name: string; program_id: string; code: string };
export type PeriodFaculty = { id: string; full_name: string; designation: string };
export type PeriodRule = {
  id: string;
  owner_section_id: string;
  subject_id: string;
  faculty_id: string;
  label: string;
  kind: string;
  slots: string[];
  starts_at: string;
  ends_at: string;
  weekday: number | null;
  on_date: string | null;
  effective_from: string;
  effective_until: string;
  active: boolean;
  revision: number;
  sections: string[];
};
export type PeriodCatalog = {
  today: string;
  timezone: string;
  sections: PeriodSection[];
  subjects: PeriodSubject[];
  faculty: PeriodFaculty[];
  rules: PeriodRule[];
  exceptions: { id: string; on_date: string; kind: string; reason: string; section_id: string }[];
};
export type PlannedSession = {
  label: string;
  kind: string;
  slots: string[];
  subject_name: string;
  faculty_name: string;
  timezone: string;
  sections: { id: string; name: string; program_name: string; term_name: string }[];
};
export type PeriodSession = {
  id: string;
  session_date: string;
  starts_at: string;
  ends_at: string;
  planned: PlannedSession;
  state: PeriodState;
  revision: number;
  owner_section_id: string;
  scheduled_faculty_id: string;
  substitute_faculty_id: string | null;
  substitute_name?: string | null;
  actual_submitter?: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  lock_at: string | null;
  cancel_reason: string | null;
  marking_authority?: boolean;
};
export type PeriodRoster = {
  student_id: string;
  section_id: string;
  name_snapshot: string;
  admission_snapshot: string | null;
  mark: PeriodStatus | null;
  original_status: PeriodStatus | null;
  mark_revision: number | null;
  approved_leave: boolean;
  can_ci_correct: boolean;
};
export type PeriodDetail = {
  session: PeriodSession;
  server_time: string;
  can_mark: boolean;
  can_grace_correct: boolean;
  can_schedule: boolean;
  can_substitute: boolean;
  roster: PeriodRoster[];
  draft: { student_id: string; status: PeriodStatus }[] | null;
  history: {
    id: string;
    student_id: string | null;
    action: string;
    reason: string;
    actor_profile_id: string;
    created_at: string;
    previous: unknown;
    current: unknown;
  }[];
};
export function completePeriodMarks(roster: PeriodRoster[], values: Record<string, string>) {
  return roster.map((r) => {
    const status = r.approved_leave ? "approved_leave" : values[r.student_id];
    if (!periodStatuses.includes(status as PeriodStatus))
      throw new Error(
        `Choose Present or Absent for ${r.name_snapshot}; unmarked students are never assumed absent.`,
      );
    return { student_id: r.student_id, status: status as PeriodStatus };
  });
}
export function periodCounts(roster: PeriodRoster[]) {
  return {
    present: roster.filter((r) => r.mark === "present").length,
    absent: roster.filter((r) => r.mark === "absent").length,
    approvedLeave: roster.filter((r) => r.mark === "approved_leave").length,
    unmarked: roster.filter((r) => !r.mark).length,
  };
}
