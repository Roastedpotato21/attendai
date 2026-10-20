import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";
import { Button } from "@/components/ui/button";
import { attendanceService } from "@/lib/services";
import type { ClassAttendance } from "@/lib/types";

export const Route = createFileRoute("/reports")({ component: ReportsPage });
function ReportsPage() {
  const [rows, setRows] = useState<ClassAttendance[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    attendanceService
      .getClassAttendance()
      .then(setRows)
      .catch(() => setError(true));
  }, []);
  function download() {
    if (!rows?.length) return;
    const cell = (value: string | number) =>
      '"' +
      String(value)
        .replaceAll('"', '""')
        .replace(/^[=+@-]/, "'$&") +
      '"';
    const csv = [
      ["Class", "Attendance (%)", "Absences"],
      ...rows.map((row) => [row.className, row.rate, row.absent]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "attendance-report.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Reports"
        description="Attendance summary across recorded sessions. Scheduled report delivery is not available."
        actions={
          <Button onClick={download} disabled={!rows?.length}>
            Download CSV
          </Button>
        }
      />
      {error ? (
        <p role="alert">Unable to load attendance records. Please try again.</p>
      ) : rows === null ? (
        <p>Loading attendance records...</p>
      ) : rows.length === 0 ? (
        <p>No attendance records are available.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Class</th>
              <th>Attendance</th>
              <th>Absences</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.className}>
                <td>{row.className}</td>
                <td>{row.rate}%</td>
                <td>{row.absent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
