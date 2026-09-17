import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GraduationCap, Users, BookOpen, Bell } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard, StatusPill } from "@/components/common/page-parts";
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
import type { Faculty, ClassAttendance } from "@/lib/types";
import { facultyService, attendanceService } from "@/lib/services";

export const Route = createFileRoute("/faculty")({
  head: () => ({
    meta: [
      { title: "Faculty & Classes — AttendAI" },
      {
        name: "description",
        content:
          "Manage faculty, class ownership and who receives AI absence summaries and escalations.",
      },
      { property: "og:title", content: "Faculty & Classes — AttendAI" },
      { property: "og:description", content: "Faculty directory and class ownership mapping." },
    ],
  }),
  component: FacultyPage,
});

function FacultyPage() {
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [classAttendance, setClassAttendance] = useState<ClassAttendance[]>([]);

  useEffect(() => {
    facultyService.getAll().then(setFaculty);
    attendanceService.getClassAttendance().then(setClassAttendance);
  }, []);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Faculty & Classes"
        description="Who owns each class and who gets notified when AI finishes a parent conversation."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Faculty"
          value={String(faculty.length)}
          icon={<GraduationCap className="h-5 w-5" />}
        />
        <StatCard
          label="Classes"
          value={String(classAttendance.length)}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          label="Class teachers"
          value={String(faculty.filter((f) => f.role === "Class Teacher").length)}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Notifications today"
          value="64"
          trend="flat"
          icon={<Bell className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-2">
          <CardHeader>
            <CardTitle>Faculty directory</CardTitle>
            <CardDescription>Owners of attendance and escalation follow-up</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Department</TableHead>
                    <TableHead>Classes</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Notify</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faculty.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <p className="font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">{f.email}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{f.department}</TableCell>
                      <TableCell className="text-sm">{f.classes.join(", ") || "—"}</TableCell>
                      <TableCell>
                        <StatusPill tone="info">{f.role}</StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast.success(`Digest sent to ${f.name}`)}
                        >
                          Send digest
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
            <CardTitle>Class overview</CardTitle>
            <CardDescription>Today's rate and absentee count</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {classAttendance.map((c) => (
              <div
                key={c.className}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.className}</p>
                  <p className="text-xs text-muted-foreground">{c.absent} absent today</p>
                </div>
                <StatusPill tone={c.rate >= 90 ? "success" : c.rate >= 80 ? "warning" : "danger"}>
                  {c.rate}%
                </StatusPill>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
