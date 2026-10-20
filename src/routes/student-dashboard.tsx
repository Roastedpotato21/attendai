import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, UserCheck, UserX, Clock, AlertTriangle } from "lucide-react";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { attendanceService } from "@/lib/services";
import { useAuth } from "@/components/auth/auth-context";

export const Route = createFileRoute("/student-dashboard")({
  component: StudentDashboard,
});

function StudentDashboard() {
  const { user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["student-dashboard", user?.studentId],
    queryFn: () => {
      const studentId = user?.studentId;
      if (!studentId) throw new Error("No student profile is linked to this account.");
      return attendanceService.getStudentDashboard(studentId);
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <PageHeader title="My Attendance" description="Loading your attendance dashboard..." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="h-4 w-1/2 bg-muted rounded"></div>
                <div className="h-8 w-8 bg-muted rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-3/4 bg-muted rounded mb-2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse h-[400px]">
          <CardHeader>
            <div className="h-6 w-1/4 bg-muted rounded mb-2"></div>
            <div className="h-4 w-1/2 bg-muted rounded"></div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Attendance"
          description="An error occurred while loading your data."
        />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error Loading Data</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load attendance data. Please try again later."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const isLowAttendance = data.overallPercentage !== null && data.overallPercentage < 75;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title="My Attendance" description="View your attendance metrics and history." />

      {isLowAttendance && (
        <Alert
          variant="destructive"
          className="border-destructive/50 bg-destructive/10 text-destructive"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Low Attendance Warning</AlertTitle>
          <AlertDescription>
            Your overall attendance is {data.overallPercentage}%, which is below the required 75%
            threshold. Please ensure you attend upcoming classes to avoid academic penalties.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Overall Attendance"
          value={data.overallPercentage === null ? "No records" : `${data.overallPercentage}%`}
          icon={<CalendarCheck className="h-4 w-4 text-primary" />}
          delta={
            data.overallPercentage === null
              ? "No attendance recorded"
              : isLowAttendance
                ? "Needs Improvement"
                : "On Track"
          }
          trend={data.overallPercentage === null ? "flat" : isLowAttendance ? "down" : "up"}
        />
        <StatCard
          label="Classes Present"
          value={data.presentCount.toString()}
          icon={<UserCheck className="h-4 w-4 text-emerald-500" />}
        />
        <StatCard
          label="Classes Absent"
          value={data.absentCount.toString()}
          icon={<UserX className="h-4 w-4 text-destructive" />}
        />
        <StatCard
          label="Late Arrivals"
          value={data.lateCount.toString()}
          icon={<Clock className="h-4 w-4 text-warning" />}
        />
      </div>

      <Card className="glass-panel">
        <CardHeader>
          <CardTitle>Attendance History</CardTitle>
          <CardDescription>Recent records of your class attendance.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.history.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CalendarCheck className="mx-auto h-10 w-10 opacity-20 mb-3" />
              <p>No attendance records found.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <div className="grid grid-cols-3 bg-muted/50 p-3 text-sm font-medium">
                <div>Date</div>
                <div>Class</div>
                <div className="text-right">Status</div>
              </div>
              <div className="divide-y max-h-[400px] overflow-auto">
                {data.history.map((record) => (
                  <div
                    key={record.id}
                    className="grid grid-cols-3 p-3 text-sm items-center hover:bg-muted/30 transition-colors"
                  >
                    <div>
                      {new Date(record.date).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div className="font-medium">{record.className}</div>
                    <div className="text-right flex justify-end">
                      <StatusPill tone={toneForStatus(record.status)}>{record.status}</StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
