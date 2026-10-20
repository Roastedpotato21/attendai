import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarCheck, PhoneCall, MessageSquare, TriangleAlert, ArrowUpRight } from "lucide-react";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

import type {
  AIInsight,
  AttendanceTrend,
  CallRecord,
  ClassAttendance,
  KPIs,
  LanguageSplit,
  Student,
} from "@/lib/types";
import {
  studentService,
  attendanceService,
  voiceCallService,
  insightsService,
} from "@/lib/services";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — AttendAI Attendance Intelligence" },
      {
        name: "description",
        content:
          "Live attendance KPIs, absentees, AI voice call activity, parent messaging and escalation alerts in one dashboard.",
      },
      { property: "og:title", content: "Dashboard — AttendAI" },
      {
        property: "og:description",
        content: "Attendance KPIs, AI calls, parent messages and students needing attention.",
      },
    ],
  }),
  component: Dashboard,
});

const pieColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function Dashboard() {
  const [loadError, setLoadError] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [absentToday, setAbsentToday] = useState<Student[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [attendanceTrend, setAttendanceTrend] = useState<AttendanceTrend[]>([]);
  const [classAttendance, setClassAttendance] = useState<ClassAttendance[]>([]);
  const [languageSplit, setLanguageSplit] = useState<LanguageSplit[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);

  useEffect(() => {
    Promise.all([
      studentService.getAll(),
      studentService.getAbsentToday(),
      studentService.getKPIs(),
      attendanceService.getTrend(),
      attendanceService.getClassAttendance(),
      attendanceService.getLanguageSplit(),
      voiceCallService.getAll(),
      insightsService.getAll(),
    ])
      .then(
        ([
          studentsData,
          absentData,
          kpisData,
          trendData,
          classAttData,
          langSplitData,
          callsData,
          insightsData,
        ]) => {
          setStudents(studentsData);
          setAbsentToday(absentData);
          setKpis(kpisData);
          setAttendanceTrend(trendData);
          setClassAttendance(classAttData);
          setLanguageSplit(langSplitData);
          setCalls(callsData);
          setAiInsights(insightsData);
        },
      )
      .catch(() => setLoadError(true));
  }, []);

  const attention = students
    .filter((student) => student.attendanceRate !== null && student.attendanceRate < 75)
    .sort((a, b) => (a.attendanceRate ?? 0) - (b.attendanceRate ?? 0))
    .slice(0, 6);

  if (loadError)
    return (
      <p role="alert" className="p-8">
        Unable to load institution records. Please reload to try again.
      </p>
    );

  if (!kpis) {
    return <div className="p-8 text-center text-muted-foreground">Loading dashboard...</div>;
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Attendance dashboard"
        description="Here's what AttendAI handled across your campus today."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/reports">View reports</Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Attendance today"
          value={kpis.attendanceToday === null ? "No records" : `${kpis.attendanceToday}%`}
          icon={<CalendarCheck className="h-5 w-5" />}
          hint={`${absentToday.length} students unaccounted`}
        />
        <StatCard
          label="AI voice calls"
          value={String(kpis.callsToday)}
          delta={kpis.callSuccess === null ? "No calls recorded" : `${kpis.callSuccess}% completed`}
          icon={<PhoneCall className="h-5 w-5" />}
        />
        <StatCard
          label="Messages sent"
          value={String(kpis.messagesSent)}
          trend="flat"
          icon={<MessageSquare className="h-5 w-5" />}
          hint="Provider-accepted or delivered messages today"
        />
        <StatCard
          label="Open escalations"
          value={String(kpis.openEscalations)}
          trend="down"
          icon={<TriangleAlert className="h-5 w-5" />}
          hint="L1 → L4 workflow"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-2">
          <CardHeader>
            <CardTitle>Attendance & AI call trend</CardTitle>
            <CardDescription>
              Daily attendance percentage and recorded call count, last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={attendanceTrend} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="presentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="callFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                    color: "var(--color-popover-foreground)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="present"
                  stroke="var(--color-chart-1)"
                  fill="url(#presentFill)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="calls"
                  stroke="var(--color-chart-2)"
                  fill="url(#callFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Parent language mix</CardTitle>
            <CardDescription>Preferred language for AI outreach</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={languageSplit}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={3}
                >
                  {languageSplit.map((entry, i) => (
                    <Cell key={entry.name} fill={pieColors[i % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-2">
          <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="min-w-0">
              <CardTitle>Absent today</CardTitle>
              <CardDescription>AI outreach status per student</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/attendance">
                All <ArrowUpRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {absentToday.slice(0, 6).map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.className} · {s.roll} · Parent prefers {s.language}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={toneForStatus(s.status)}>{s.status}</StatusPill>
                  <StatusPill tone={toneForStatus(s.risk)}>{s.risk} risk</StatusPill>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Class-wise attendance</CardTitle>
            <CardDescription>Across recorded attendance sessions</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={classAttendance} margin={{ left: -20, right: 8 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="className"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
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
                <Bar dataKey="rate" radius={[8, 8, 0, 0]} fill="var(--color-chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Recent AI calls</CardTitle>
            <CardDescription>Parent responses summarised by AI</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {calls.slice(0, 4).map((c) => (
              <div key={c.id} className="rounded-xl border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <p className="truncate text-sm font-medium">{c.student}</p>
                  <StatusPill tone={toneForStatus(c.status)}>{c.status}</StatusPill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.language} · {c.attempts} attempt(s)
                </p>
                <Separator className="my-2" />
                <p className="line-clamp-2 text-xs text-muted-foreground">{c.aiSummary}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Students needing attention</CardTitle>
            <CardDescription>Below the 75% attendance threshold</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {attention.map((s) => (
              <div key={s.id}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {s.attendanceRate}%
                  </span>
                </div>
                <Progress value={s.attendanceRate ?? 0} className="mt-2 h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>AI insights</CardTitle>
            <CardDescription>Published insights</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiInsights.slice(0, 3).map((i) => (
              <div key={i.id} className="rounded-xl border bg-muted/40 p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <p className="truncate text-sm font-medium">{i.title}</p>
                  <StatusPill tone={i.impact === "high" ? "danger" : "warning"}>
                    {i.metric}
                  </StatusPill>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.detail}</p>
              </div>
            ))}
            <Button variant="outline" className="w-full" asChild>
              <Link to="/insights">Open AI Insights</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
