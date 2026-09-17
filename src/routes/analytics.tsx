import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import {
  Filter,
  AlertTriangle,
  UserX,
  CalendarX,
  TrendingDown,
  ShieldCheck,
  Sparkles,
  Bot,
} from "lucide-react";

import { PageHeader, StatusPill } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { analyticsService, aiAnalysisService } from "@/lib/services";
import { classRepository } from "@/lib/db/repositories/class";
import type { DbClass } from "@/lib/db/schema";
import type { RiskLevel, StudentRiskProfile, StudentAIInsight } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics & Risk — AttendAI" },
      {
        name: "description",
        content: "Analytics dashboard for attendance and student risk detection.",
      },
    ],
  }),
  component: AnalyticsDashboard,
});

function RiskBadge({ level }: { level: RiskLevel }) {
  if (level === "critical")
    return (
      <Badge
        variant="outline"
        className="border-destructive bg-destructive/15 text-destructive font-semibold"
      >
        Critical Risk
      </Badge>
    );
  if (level === "high")
    return (
      <Badge
        variant="outline"
        className="border-destructive/30 bg-destructive/10 text-destructive font-medium"
      >
        High Risk
      </Badge>
    );
  if (level === "medium")
    return (
      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning font-medium">
        Medium Risk
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-success font-medium">
      Low Risk
    </Badge>
  );
}

function AnalyticsDashboard() {
  const [classId, setClassId] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [classes, setClasses] = useState<DbClass[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentRiskProfile | null>(null);

  useEffect(() => {
    classRepository.findAll().then(setClasses);
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["analytics", classId, startDate, endDate],
    queryFn: () => {
      const filters: { classId?: string; startDate?: string; endDate?: string } = {};
      if (classId !== "all") filters.classId = classId;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      return analyticsService.getDashboardData(filters);
    },
  });

  const { data: classInsights, isLoading: loadingInsights } = useQuery({
    queryKey: ["ai-class-insights", data],
    queryFn: () => (data ? aiAnalysisService.generateClassInsights(data) : []),
    enabled: !!data,
  });

  const { data: studentInsight, isLoading: loadingStudentInsight } = useQuery({
    queryKey: ["ai-student-insight", selectedStudent?.studentId],
    queryFn: () =>
      selectedStudent ? aiAnalysisService.generateStudentInsights(selectedStudent) : null,
    enabled: !!selectedStudent,
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-[1400px] mx-auto">
      <PageHeader
        title="Analytics & Risk Detection"
        description="Monitor class attendance trends and identify at-risk students."
      />

      <Card className="glass-panel">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-end gap-4">
            <div className="space-y-2 flex-1 w-full">
              <Label className="flex items-center gap-2">
                <Filter className="w-4 h-4" /> Class Filter
              </Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Classes</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1 w-full">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2 flex-1 w-full">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="h-[400px] animate-pulse bg-muted/20"></Card>
          <Card className="h-[400px] animate-pulse bg-muted/20"></Card>
        </div>
      ) : isError ? (
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="p-6 text-center text-destructive">
            <AlertTriangle className="mx-auto h-8 w-8 mb-2" />
            <p className="font-medium">Failed to load analytics data.</p>
          </CardContent>
        </Card>
      ) : !data ? null : (
        <div className="space-y-6">
          {/* AI Insights Panel */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-primary">
                <Sparkles className="h-5 w-5" />
                AI Class Insights
                {loadingInsights && (
                  <span className="text-sm font-normal text-muted-foreground ml-auto animate-pulse">
                    Analyzing data...
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingInsights ? (
                <div className="space-y-3">
                  <div className="h-4 bg-primary/10 rounded w-3/4 animate-pulse"></div>
                  <div className="h-4 bg-primary/10 rounded w-1/2 animate-pulse"></div>
                </div>
              ) : classInsights && classInsights.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  {classInsights.map((insight) => (
                    <div
                      key={insight.id}
                      className="flex gap-3 bg-background/60 p-4 rounded-lg border border-primary/10"
                    >
                      <div className="mt-0.5">
                        <Bot className="h-5 w-5 text-primary/70" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">{insight.title}</h4>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                          {insight.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No significant anomalies detected in the current view.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="card-elevated flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-primary" />
                  Class-wise Attendance %
                </CardTitle>
                <CardDescription>
                  Overall attendance percentage per class for the selected period.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 min-h-[300px]">
                {data.classWiseAttendance.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60">
                    <CalendarX className="h-10 w-10 mb-2" />
                    <p>No attendance data available.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.classWiseAttendance}
                      layout="vertical"
                      margin={{ left: 24, right: 16 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border)"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
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
                        width={100}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--color-muted)" }}
                        formatter={(value: number) => [`${value}%`, "Attendance"]}
                        contentStyle={{
                          background: "var(--color-popover)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                        }}
                      />
                      <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
                        {data.classWiseAttendance.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              entry.percentage < 75
                                ? "var(--color-destructive)"
                                : "var(--color-primary)"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="card-elevated flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserX className="h-5 w-5 text-destructive" />
                  At-Risk Students
                </CardTitle>
                <CardDescription>
                  Students with &lt;75% attendance or consecutive absences.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto max-h-[400px]">
                {data.atRiskStudents.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-60 min-h-[200px]">
                    <ShieldCheck className="h-10 w-10 mb-2 text-success" />
                    <p>No at-risk students found.</p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <div className="grid grid-cols-4 bg-muted/50 p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <div className="col-span-2">Student</div>
                      <div className="text-right">Attendance</div>
                      <div className="text-right">Risk</div>
                    </div>
                    <div className="divide-y">
                      {data.atRiskStudents.map((student) => (
                        <div
                          key={student.studentId}
                          onClick={() => setSelectedStudent(student)}
                          className="grid grid-cols-4 p-3 text-sm items-center hover:bg-muted/30 transition-colors cursor-pointer group"
                        >
                          <div className="col-span-2 min-w-0">
                            <p
                              className="font-medium truncate group-hover:text-primary transition-colors"
                              title={student.name}
                            >
                              {student.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {student.className}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-destructive">
                              {student.attendancePercentage}%
                            </p>
                            {student.consecutiveAbsences > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {student.consecutiveAbsences} consecutive
                              </p>
                            )}
                          </div>
                          <div className="text-right flex justify-end">
                            <RiskBadge level={student.riskLevel} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* AI Student Profile Dialog */}
      <Dialog open={!!selectedStudent} onOpenChange={(open) => !open && setSelectedStudent(null)}>
        <DialogContent className="sm:max-w-[550px] border-primary/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" />
              AI Student Profile
            </DialogTitle>
            <DialogDescription>
              Personalized insights and recommendations for {selectedStudent?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {loadingStudentInsight ? (
              <div className="space-y-4">
                <div className="h-20 bg-primary/5 rounded-lg animate-pulse" />
                <div className="h-20 bg-primary/5 rounded-lg animate-pulse" />
              </div>
            ) : studentInsight ? (
              <>
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/10">
                  <h4 className="font-semibold text-sm mb-2 text-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-primary" /> Risk Explanation
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {studentInsight.riskExplanation}
                  </p>

                  {studentInsight.unusualPatterns.length > 0 && (
                    <div className="mt-4">
                      <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Unusual Patterns
                      </h5>
                      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                        {studentInsight.unusualPatterns.map((p, idx) => (
                          <li key={idx}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="font-semibold text-sm mb-3">Recommended Actions</h4>
                  <div className="space-y-2">
                    {studentInsight.recommendedActions.map((action, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/30 transition-colors"
                      >
                        <span className="text-sm font-medium">{action.action}</span>
                        <Button size="sm" variant="outline" className="h-8 shadow-sm">
                          {action.type === "communication" ? "Send Message" : "Take Action"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unable to generate insights for this student.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
