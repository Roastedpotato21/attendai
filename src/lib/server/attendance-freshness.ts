import { ATTENDANCE_PUSH_TTL_SECONDS } from "./fcm-provider.ts";

export type AttendanceSessionFreshness = {
  date: string;
  created_at: string;
  status: string;
  institution_id: string;
};

export function isFreshAttendanceSession(
  session: AttendanceSessionFreshness | null | undefined,
  now = Date.now(),
): boolean {
  if (!session || session.status !== "submitted") return false;
  const createdAt = Date.parse(session.created_at);
  const attendanceDay = Date.parse(`${session.date}T00:00:00Z`);
  const age = now - createdAt;
  const dayAge = Math.floor((now - attendanceDay) / 86400000);
  return (
    Number.isFinite(createdAt) &&
    Number.isFinite(attendanceDay) &&
    age >= 0 &&
    age <= ATTENDANCE_PUSH_TTL_SECONDS * 1000 &&
    dayAge >= 0 &&
    dayAge <= 1
  );
}
