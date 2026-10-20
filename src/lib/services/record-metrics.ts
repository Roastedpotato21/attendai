import { format } from "date-fns";
import type { MessageStatus } from "../types";
import type { DbAttendanceRecord, DbAttendanceSession, DbCommunication } from "../db/schema";

export const todayDate = () => format(new Date(), "yyyy-MM-dd");

export function recordsForDate(
  sessions: DbAttendanceSession[],
  records: DbAttendanceRecord[],
  date: string,
): DbAttendanceRecord[] {
  const ids = new Set(
    sessions.filter((session) => session.date === date).map((session) => session.id),
  );
  return records.filter((record) => ids.has(record.sessionId));
}

export function attendancePercentage(records: DbAttendanceRecord[]): number | null {
  const marked = records.filter((record) => ["present", "late", "absent"].includes(record.status));
  if (!marked.length) return null;
  const attended = marked.filter((record) => record.status !== "absent").length;
  return Math.round((attended / marked.length) * 100);
}

export function acceptedMessage(record: DbCommunication): boolean {
  return (
    record.type !== "voice" &&
    !isSimulatedCommunication(record) &&
    !!record.providerMessageId &&
    [record.messageStatus, record.smsStatus].some(
      (status) =>
        status === "sent" ||
        status === "delivered" ||
        status === "read" ||
        status === "provider_accepted",
    )
  );
}

export function isSimulatedCommunication(record: DbCommunication): boolean {
  return (
    /mock|simulat/i.test(record.providerName ?? "") ||
    /^(mock|SMsimulated)/i.test(record.providerMessageId ?? "")
  );
}

export function messageDisplayStatus(record: DbCommunication): MessageStatus {
  if (isSimulatedCommunication(record)) return "simulated";
  const status = record.messageStatus ?? record.smsStatus ?? "unconfirmed";
  if (
    ["sent", "delivered", "read", "provider_accepted"].includes(status) &&
    !record.providerMessageId
  ) {
    return "unconfirmed";
  }
  return status;
}

export function studentHistoryMetrics(
  studentId: string,
  sessions: DbAttendanceSession[],
  records: DbAttendanceRecord[],
) {
  const dates = new Map(
    sessions
      .filter((session) => session.date <= todayDate())
      .map((session) => [session.id, session.date]),
  );
  const history = records
    .filter((record) => record.studentId === studentId && dates.has(record.sessionId))
    .sort((a, b) => dates.get(b.sessionId)!.localeCompare(dates.get(a.sessionId)!));
  const attendanceRate = attendancePercentage(history);
  let consecutiveAbsences = 0;
  for (const record of history) {
    if (record.status === "absent") consecutiveAbsences++;
    else if (record.status === "present" || record.status === "late") break;
  }
  const risk =
    attendanceRate === null
      ? "unknown"
      : attendanceRate < 75 || consecutiveAbsences >= 3
        ? "high"
        : attendanceRate < 85
          ? "medium"
          : "low";
  return { attendanceRate, consecutiveAbsences, risk } as const;
}
