import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileBarChart, CalendarRange, Mail } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageHeader, StatCard } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClassAttendance } from "@/lib/types";
import { attendanceService } from "@/lib/services";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — AttendAI" },
      {
        name: "description",
        content:
          "Scheduled and on-demand attendance, outreach and escalation reports for faculty and management.",
      },
      { property: "og:title", content: "Reports — AttendAI" },
      { property: "og:description", content: "Attendance, outreach and compliance reporting." },
    ],
  }),
  component: ReportsPage,
});

const reports = [
  {
    id: "R-01",
    name: "Daily attendance summary",
    scope: "All classes",
    schedule: "Daily 6:00 PM",
    format: "PDF",
  },
  {
    id: "R-02",
    name: "Parent outreach effectiveness",
    scope: "AI calls + messages",
    schedule: "Weekly Mon",
    format: "XLSX",
  },
  {
    id: "R-03",
    name: "Below-threshold students",
    scope: "< 75% attendance",
    schedule: "Weekly Fri",
    format: "PDF",
  },
  { id: "R-04", name: "Escalation audit", scope: "L1–L4", schedule: "Monthly", format: "CSV" },
  {
    id: "R-05",
    name: "Language-wise response report",
    scope: "All parents",
    schedule: "Monthly",
    format: "XLSX",
  },
];

function ReportsPage() {
  const [classAttendance, setClassAttendance] = useState<ClassAttendance[]>([]);

  useEffect(() => {
    attendanceService.getClassAttendance().then(setClassAttendance);
  }, []);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Reports"
        description="Export-ready reporting for faculty, management and compliance reviews."
        actions={
          <Button onClick={() => toast.success("Report generation queued (simulation)")}>
            <Download className="mr-2 h-4 w-4" />
            Generate report
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Reports available"
          value={String(reports.length)}
          icon={<FileBarChart className="h-5 w-5" />}
        />
        <StatCard label="Scheduled" value="4" icon={<CalendarRange className="h-5 w-5" />} />
        <StatCard label="Emailed this month" value="126" icon={<Mail className="h-5 w-5" />} />
        <StatCard
          label="Avg generation"
          value="3.2s"
          trend="flat"
          icon={<Download className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-2">
          <CardHeader>
            <CardTitle>Report library</CardTitle>
            <CardDescription>Run now or manage the delivery schedule</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead className="hidden md:table-cell">Scope</TableHead>
                    <TableHead className="hidden sm:table-cell">Schedule</TableHead>
                    <TableHead className="text-right">Run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.format}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{r.scope}</TableCell>
                      <TableCell className="hidden sm:table-cell">{r.schedule}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast.success(`${r.name} queued`)}
                        >
                          Run
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Absences by class</CardTitle>
            <CardDescription>This week</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classAttendance} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="className"
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  width={60}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="absent" radius={[0, 8, 8, 0]} fill="var(--color-chart-3)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
