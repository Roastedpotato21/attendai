import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  Clock,
  MessageSquare,
  X,
  Filter,
  Save,
  Calendar,
  CheckSquare,
  QrCode,
  Play,
  Square,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "react-qr-code";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type {
  Student,
  AttendanceSubmissionResult,
  StudentStatus,
  QRSession,
  QRCheckIn,
} from "@/lib/types";
import { attendanceService, qrService, auditService } from "@/lib/services";
import type { DbClass } from "@/lib/db/schema";
import { useAuth } from "@/components/auth/auth-context";
import { LOCAL_IP } from "@/lib/local-ip";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance Register — AttendAI" },
      {
        name: "description",
        content:
          "Mark, filter and audit daily attendance by class, then trigger AI parent outreach for absentees.",
      },
      { property: "og:title", content: "Attendance Register — AttendAI" },
      {
        property: "og:description",
        content: "Daily attendance register with one-click AI absence workflow.",
      },
    ],
  }),
  component: AttendancePage,
});

function AttendancePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Student[]>([]);
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [dateStr, setDateStr] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [classOptions, setClassOptions] = useState<DbClass[]>([]);
  const [isLoadingClasses, setIsLoadingClasses] = useState(true);
  const [isLoadingRegister, setIsLoadingRegister] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | undefined>(undefined);
  const selectedClass = classOptions.find((cls) => cls.id === classFilter);
  const [mode, setMode] = useState<"manual" | "qr">("manual");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [summary, setSummary] = useState<AttendanceSubmissionResult | null>(null);

  // Manual Mode State
  const [markedStatus, setMarkedStatus] = useState<Record<string, StudentStatus>>({});

  // QR Mode State
  const [qrSession, setQrSession] = useState<QRSession | null>(null);
  const qrSessionRef = useRef<QRSession | null>(null);
  const [qrCheckIns, setQrCheckIns] = useState<QRCheckIn[]>([]);
  const [isStartingQR, setIsStartingQR] = useState(false);

  const stopQRSession = useCallback(async () => {
    if (!qrSession) return;
    await qrService.stopSession(qrSession.id);
    setQrSession({ ...qrSession, active: false });
    toast.info("QR Session stopped. Please review and submit.");
  }, [qrSession]);

  useEffect(() => {
    let active = true;
    attendanceService
      .getClasses()
      .then((data) => {
        if (active) setClassOptions(data);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Unable to load classes.");
      })
      .finally(() => {
        if (active) setIsLoadingClasses(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    qrSessionRef.current = qrSession;
  }, [qrSession]);

  // When class/date changes, reset marked status and active QR sessions
  useEffect(() => {
    let active = true;
    setMarkedStatus({});
    setRows([]);
    setSavedSessionId(null);
    setSavedRevision(undefined);
    setSummary(null);
    const activeSession = qrSessionRef.current;
    if (activeSession) {
      void qrService.stopSession(activeSession.id);
      setQrSession(null);
      setQrCheckIns([]);
    }
    if (classFilter === "all") {
      setIsLoadingRegister(false);
      return;
    }
    setIsLoadingRegister(true);
    setLoadError(null);
    attendanceService
      .getRegister(classFilter, dateStr)
      .then((register) => {
        if (!active) return;
        setRows(register.students);
        setSavedSessionId(register.session?.id ?? null);
        setSavedRevision(register.session?.revision);
        setMarkedStatus(
          Object.fromEntries(register.records.map((record) => [record.studentId, record.status])),
        );
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Unable to load attendance.");
      })
      .finally(() => {
        if (active) setIsLoadingRegister(false);
      });
    return () => {
      active = false;
    };
  }, [classFilter, dateStr]);

  // Poll for QR check-ins if session is active
  useEffect(() => {
    if (!qrSession || !qrSession.active) return;
    const interval = setInterval(async () => {
      const live = await qrService.getLiveCheckIns(qrSession.id);
      setQrCheckIns(live);
    }, 2000);
    return () => clearInterval(interval);
  }, [qrSession]);

  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!qrSession || !qrSession.active) {
      setTimeLeft(null);
      return;
    }

    const calculateTimeLeft = () => {
      const diff = new Date(qrSession.expiresAt).getTime() - Date.now();
      return Math.max(0, Math.floor(diff / 1000));
    };

    setTimeLeft(calculateTimeLeft());

    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      if (remaining <= 0) {
        stopQRSession();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [qrSession, stopQRSession]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Merge students with their derived status based on the selected mode
  const students = useMemo(() => {
    return rows.map((s) => {
      let status: StudentStatus = "unmarked";
      if (mode === "manual") {
        status = markedStatus[s.id] || "unmarked";
      } else if (mode === "qr") {
        // Find if student checked in successfully
        const checkin = qrCheckIns.find((c) => c.studentId === s.id);
        if (checkin) {
          status = checkin.status === "valid" ? "present" : "unmarked"; // In real app, we might flag invalid_proximity
        }
        // Allow manual override even in QR mode
        if (markedStatus[s.id]) {
          status = markedStatus[s.id]!;
        }
      }
      return { ...s, status };
    });
  }, [rows, markedStatus, mode, qrCheckIns]);

  const filtered = students.filter(
    (s) => s.name.toLowerCase().includes(query.toLowerCase()) || s.roll.includes(query),
  );

  const setStatus = async (id: string, status: StudentStatus) => {
    if (mode === "qr") {
      const reason = window.prompt(
        `Please provide a reason for manually overriding this student's attendance to '${status}':`,
      );
      if (!reason || reason.trim() === "") {
        toast.info("Override cancelled. Reason is required.");
        return;
      }

      await auditService.log(
        "Faculty QR Override",
        `Student: ${id}, New Status: ${status}, Reason: ${reason}`,
        "warning",
        user?.id,
      );
    }
    setMarkedStatus((prev) => ({ ...prev, [id]: status }));
  };

  const markAllPresent = () => {
    if (classFilter === "all") {
      toast.error("Please select a specific class first to mark all present.");
      return;
    }
    const updates: Record<string, StudentStatus> = {};
    filtered.forEach((s) => {
      updates[s.id] = "present";
    });
    setMarkedStatus((prev) => ({ ...prev, ...updates }));
    toast.success(`Marked all ${filtered.length} students as Present`);
  };

  const startQRSession = async () => {
    if (classFilter === "all") {
      toast.error("Please select a class first.");
      return;
    }
    if (!user) {
      toast.error("Authentication required to start a session.");
      return;
    }
    setIsStartingQR(true);
    toast.loading("Generating Secure QR...", { id: "qr" });
    try {
      const session = await qrService.startSession(
        selectedClass?.name ?? classFilter,
        dateStr,
        5,
        user.id,
      );
      console.log("[QR CLIENT] generated session ID:", session.id);

      // We must construct an explicit dev network URL if available instead of window.location.origin
      const baseUrl =
        LOCAL_IP && (LOCAL_IP as string) !== "localhost"
          ? `http://${LOCAL_IP}:5173`
          : window.location.origin;
      const url = `${baseUrl}/check-in?session=${session.id}`;
      console.log("[QR CLIENT] QR URL:", url);
      setQrSession(session);
      toast.success("QR Session Active", { id: "qr" });
    } catch (e) {
      console.error("[QR CLIENT] Failed to start session:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to start session: ${msg}`, { id: "qr" });
    } finally {
      setIsStartingQR(false);
    }
  };

  const submitRegister = async () => {
    if (classFilter === "all") {
      toast.error("Please select a specific class before submitting.");
      return;
    }

    if (qrSession?.active) {
      toast.error("Please stop the QR session before submitting.");
      return;
    }

    if (isLoadingRegister || loadError || students.length === 0) {
      toast.error("Load a class with students before submitting attendance.");
      return;
    }
    const unmarked = students.filter((s) => s.status === "unmarked");
    if (unmarked.length > 0) {
      toast.error(`${unmarked.length} students are still unmarked.`);
      return;
    }

    setIsSubmitting(true);
    toast.loading("Saving attendance...", { id: "submit" });

    try {
      const result = await attendanceService.submitAttendance({
        date: dateStr,
        classId: classFilter,
        sessionId: savedSessionId ?? undefined,
        expectedRevision: savedRevision,
        className: selectedClass?.fullName ?? classFilter,
        method: mode === "qr" ? "qr" : "faculty",
        records: students.map((s) => ({
          studentId: s.id,
          status: s.status,
        })),
      });

      toast.success(result.message, { id: "submit" });
      setSummary(result);
      setSavedSessionId(result.sessionId ?? null);
      setSavedRevision(result.revision);
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "Failed to submit attendance";
      toast.error(msg, { id: "submit" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const counts = {
    present: students.filter((s) => s.status === "present").length,
    absent: students.filter((s) => s.status === "absent").length,
    late: students.filter((s) => s.status === "late").length,
    unmarked: students.filter((s) => s.status === "unmarked").length,
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Attendance"
        description="Mark daily attendance by class, then submit the register and trigger AI outreach."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present"
          value={String(counts.present)}
          icon={<Check className="h-5 w-5" />}
        />
        <StatCard
          label="Absent"
          value={String(counts.absent)}
          trend="down"
          icon={<X className="h-5 w-5" />}
        />
        <StatCard
          label="Late"
          value={String(counts.late)}
          trend="flat"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Unmarked"
          value={String(counts.unmarked)}
          hint={classFilter !== "all" ? "Requires marking" : ""}
          icon={<Filter className="h-5 w-5" />}
        />
      </div>

      <Card className="card-elevated mt-4">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle>Daily register</CardTitle>
            <CardDescription>
              {classFilter === "all"
                ? "Select a class to mark attendance"
                : `${students.length} students in ${selectedClass?.fullName ?? "selected class"}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              disabled={isSubmitting}
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
        </CardHeader>
        <CardContent>
          {!isLoadingClasses && !loadError && classOptions.length === 0 && (
            <p className="mb-4 text-sm text-muted-foreground">
              No classes are available for attendance. Ask your administrator to create a class or
              assign you to one.
            </p>
          )}
          {loadError && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {loadError}
            </p>
          )}
          {savedSessionId && (
            <p className="mb-4 text-sm text-muted-foreground">
              Saved attendance loaded for {dateStr}.
            </p>
          )}
          <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "qr")} className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={classFilter} onValueChange={setClassFilter} disabled={isSubmitting}>
                  <SelectTrigger className="h-9 w-[150px]">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Select a class</SelectItem>
                    {classOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Search name or roll no."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 w-full sm:w-[200px]"
                />
              </div>

              <TabsList>
                <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                <TabsTrigger value="qr">
                  <QrCode className="mr-2 h-4 w-4" />
                  QR Mode
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="manual" className="mt-4">
              {classFilter !== "all" && (
                <div className="mb-4 flex gap-2">
                  <Button variant="outline" size="sm" onClick={markAllPresent}>
                    <CheckSquare className="mr-2 h-4 w-4" />
                    Mark All Present
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="qr" className="mt-4">
              {classFilter !== "all" && (
                <div className="mb-6 rounded-xl border bg-muted/30 p-6 text-center">
                  {!qrSession ? (
                    <div className="space-y-4">
                      <QrCode className="mx-auto h-12 w-12 text-muted-foreground" />
                      <div>
                        <h3 className="font-semibold">QR attendance unavailable</h3>
                        <p className="text-sm text-muted-foreground">
                          Student identity and proximity verification are not enabled. Use faculty
                          marking to record attendance.
                        </p>
                      </div>
                      <Button onClick={startQRSession} disabled>
                        <Play className="mr-2 h-4 w-4" />
                        Unavailable
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center space-y-4">
                      {qrSession.active ? (
                        <>
                          <div className="flex h-64 w-64 items-center justify-center rounded-xl bg-white p-4 shadow-sm">
                            <QRCode
                              value={(() => {
                                let baseUrl = window.location.origin;
                                if (
                                  baseUrl.includes("localhost") ||
                                  baseUrl.includes("127.0.0.1")
                                ) {
                                  if (LOCAL_IP && (LOCAL_IP as string) !== "localhost") {
                                    baseUrl = `http://${LOCAL_IP}:${window.location.port || "5173"}`;
                                  }
                                }
                                const finalUrl = `${baseUrl}/check-in?session=${qrSession.id}`;
                                console.log("Generated QR URL:", finalUrl);
                                return finalUrl;
                              })()}
                              style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="relative flex h-3 w-3">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"></span>
                              <span className="relative inline-flex h-3 w-3 rounded-full bg-success"></span>
                            </span>
                            <span className="font-medium text-success">
                              Session Active
                              {timeLeft !== null && ` — ${formatTime(timeLeft)} remaining`}
                            </span>
                          </div>

                          <Button variant="outline" asChild>
                            <a
                              href={`/check-in?session=${qrSession.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open Student Simulator
                            </a>
                          </Button>

                          <Button variant="destructive" onClick={stopQRSession}>
                            <Square className="mr-2 h-4 w-4" />
                            Stop Session
                          </Button>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <CheckSquare className="mx-auto h-12 w-12 text-muted-foreground" />
                          <h3 className="font-semibold">Session Ended</h3>
                          <p className="text-sm text-muted-foreground">
                            Review the check-ins below and submit the register.
                          </p>
                          <Button variant="outline" onClick={() => setQrSession(null)}>
                            Reset
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden lg:table-cell">Parent</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Mark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classFilter === "all" ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      Please select a class to begin marking attendance for {dateStr}.
                    </TableCell>
                  </TableRow>
                ) : isLoadingRegister ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      Loading register...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      No students found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.roll}</p>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <p className="text-sm">{s.parentName}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.parentPhone} · {s.language}
                        </p>
                      </TableCell>
                      <TableCell>
                        {s.attendanceRate === null ? "No records" : `${s.attendanceRate}%`}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={toneForStatus(s.status)}>{s.status}</StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            size="sm"
                            disabled={isSubmitting}
                            variant={s.status === "present" ? "default" : "outline"}
                            onClick={() => setStatus(s.id, "present")}
                          >
                            P
                          </Button>
                          <Button
                            size="sm"
                            disabled={isSubmitting}
                            variant={s.status === "absent" ? "destructive" : "outline"}
                            onClick={() => setStatus(s.id, "absent")}
                          >
                            A
                          </Button>
                          <Button
                            size="sm"
                            disabled={isSubmitting}
                            variant={s.status === "late" ? "secondary" : "outline"}
                            onClick={() => setStatus(s.id, "late")}
                          >
                            L
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        {classFilter !== "all" && (
          <CardFooter className="flex justify-end border-t pt-4">
            <Button
              onClick={submitRegister}
              disabled={
                isSubmitting ||
                isLoadingRegister ||
                students.length === 0 ||
                !!loadError ||
                qrSession?.active
              }
            >
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting ? "Saving..." : savedSessionId ? "Save Changes" : "Submit Register"}
            </Button>
          </CardFooter>
        )}
      </Card>

      <Dialog open={!!summary} onOpenChange={(open) => !open && setSummary(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {summary?.updated ? "Register Updated" : "Register Submitted"}
            </DialogTitle>
            <DialogDescription>
              Attendance for {selectedClass?.fullName} on {dateStr} has been saved.
            </DialogDescription>
          </DialogHeader>
          {summary && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border p-3">
                  <p className="text-2xl font-bold text-success">{summary.totalPresent}</p>
                  <p className="text-xs text-muted-foreground">Present</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-2xl font-bold text-destructive">{summary.totalAbsent}</p>
                  <p className="text-xs text-muted-foreground">Absent</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-2xl font-bold text-warning">{summary.totalLate}</p>
                  <p className="text-xs text-muted-foreground">Late</p>
                </div>
              </div>

              {summary.totalAbsent > 0 && (
                <p className="text-sm text-muted-foreground">
                  Absence alerts are queued only for guardians with consent and notifications
                  enabled, subject to rate limits. Check message status to see whether an alert was
                  created and delivered.
                </p>
              )}

              <DialogFooter className="sm:justify-between">
                <Button variant="outline" onClick={() => setSummary(null)}>
                  Close
                </Button>
                {summary.totalAbsent > 0 && (
                  <Button asChild>
                    <Link to="/messages">
                      <MessageSquare className="mr-2 h-4 w-4" />
                      View Message Status
                    </Link>
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
