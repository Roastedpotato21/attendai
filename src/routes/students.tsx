import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PhoneCall, MessageSquare, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import {
  PageHeader,
  StatCard,
  StatusPill,
  toneForStatus,
  DetailRow,
} from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Student } from "@/lib/types";
import { communication, studentService } from "@/lib/services";

export const Route = createFileRoute("/students")({
  head: () => ({
    meta: [
      { title: "Students & Parents — AttendAI" },
      {
        name: "description",
        content:
          "Student directory with parent contacts, preferred language, attendance rate and risk level.",
      },
      { property: "og:title", content: "Students & Parents — AttendAI" },
      {
        property: "og:description",
        content: "Directory of students, guardians and outreach preferences.",
      },
    ],
  }),
  component: StudentsPage,
});

function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);

  useEffect(() => {
    studentService.getAll().then(setStudents);
  }, []);

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.parentName.toLowerCase().includes(query.toLowerCase()) ||
      s.className.toLowerCase().includes(query.toLowerCase()),
  );

  const call = async (s: Student) => {
    toast.loading("Placing AI voice call…", { id: s.id });
    try {
      const res = await communication.voice.call({
        to: s.parentPhone,
        language: s.language,
        scriptTemplateId: "T-06",
        variables: { student_name: s.name },
      });
      toast.success(`AI call ${res.id} queued in ${s.language}`, {
        id: s.id,
        description: res.note,
      });
    } catch (error) {
      console.error("Voice call failed:", error);
      toast.error(`Failed to place call for ${s.name}`, { id: s.id });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Students & Parents"
        description="Single source of truth for guardians, contact channels and language preferences."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total students"
          value={String(students.length)}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="High risk"
          value={String(students.filter((s) => s.risk === "high").length)}
          trend="down"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          label="Parents on WhatsApp"
          value="87%"
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <StatCard
          label="Voice-preferred"
          value="41%"
          trend="flat"
          icon={<PhoneCall className="h-5 w-5" />}
        />
      </div>

      <Card className="card-elevated mt-4">
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>{filtered.length} records</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search student, parent or class"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-4 h-9 w-full sm:max-w-sm"
          />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden md:table-cell">Class</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead className="hidden lg:table-cell">Language</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 18).map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelected(s)}>
                    <TableCell>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.roll}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{s.className}</TableCell>
                    <TableCell>
                      <p className="text-sm">{s.parentName}</p>
                      <p className="text-xs text-muted-foreground">{s.parentPhone}</p>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{s.language}</TableCell>
                    <TableCell>
                      <StatusPill tone={toneForStatus(s.risk)}>{s.risk}</StatusPill>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void call(s);
                        }}
                      >
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
                        Call
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              {selected?.className} · Roll {selected?.roll}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <DetailRow label="Guardian" value={selected.parentName} />
              <DetailRow label="Phone" value={selected.parentPhone} />
              <DetailRow label="Preferred language" value={selected.language} />
              <Separator />
              <DetailRow
                label="Attendance rate"
                value={
                  selected.attendanceRate === null ? "No records" : `${selected.attendanceRate}%`
                }
              />
              <DetailRow
                label="Consecutive absences"
                value={String(selected.consecutiveAbsences)}
              />
              <DetailRow label="Risk" value={selected.risk} />
              <Button className="w-full" onClick={() => void call(selected)}>
                <PhoneCall className="mr-2 h-4 w-4" />
                Trigger AI voice call
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
