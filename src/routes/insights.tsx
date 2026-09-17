import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, TrendingUp, Brain, Target } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader, StatCard, StatusPill } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AIInsight, AttendanceTrend } from "@/lib/types";
import { insightsService, attendanceService } from "@/lib/services";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "AI Insights — AttendAI" },
      {
        name: "description",
        content:
          "AI-detected attendance patterns, at-risk cohorts and outreach effectiveness recommendations.",
      },
      { property: "og:title", content: "AI Insights — AttendAI" },
      {
        property: "og:description",
        content: "Patterns, predictions and outreach recommendations.",
      },
    ],
  }),
  component: InsightsPage,
});

function InsightsPage() {
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [attendanceTrend, setAttendanceTrend] = useState<AttendanceTrend[]>([]);

  useEffect(() => {
    insightsService.getAll().then(setAiInsights);
    attendanceService.getTrend().then(setAttendanceTrend);
  }, []);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="AI Insights"
        description="Patterns AttendAI found across attendance, conversations and outreach channels."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Patterns detected" value="14" icon={<Brain className="h-5 w-5" />} />
        <StatCard
          label="At-risk students"
          value="9"
          trend="down"
          icon={<Target className="h-5 w-5" />}
        />
        <StatCard label="Outreach lift" value="+23%" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Summaries generated" value="312" icon={<Sparkles className="h-5 w-5" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {aiInsights.map((i) => (
          <Card key={i.id} className="card-elevated">
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate">{i.title}</CardTitle>
                <CardDescription>Confidence high · last 30 days</CardDescription>
              </div>
              <StatusPill tone={i.impact === "high" ? "danger" : "warning"}>{i.metric}</StatusPill>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">{i.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="card-elevated mt-4">
        <CardHeader>
          <CardTitle>Absence forecast</CardTitle>
          <CardDescription>Projected absence rate for the coming week</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={attendanceTrend} margin={{ left: -20, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
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
                }}
              />
              <Line
                type="monotone"
                dataKey="absent"
                stroke="var(--color-chart-5)"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="calls"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
