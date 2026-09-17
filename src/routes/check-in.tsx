import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Scanner } from "@yudiel/react-qr-scanner";
import { CheckCircle2, ShieldAlert, MapPin, Smartphone, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Student, QRSession, QRCheckIn } from "@/lib/types";
import { studentService, qrService } from "@/lib/services";
import { userRepository } from "@/lib/db/repositories";
import { useAuth } from "@/components/auth/auth-context";

// Extract sessionId from URL query params
type CheckInSearch = {
  session?: string | undefined;
};

export const Route = createFileRoute("/check-in")({
  validateSearch: (search: Record<string, unknown>): CheckInSearch => {
    return {
      session: search["session"] as string | undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Student Check-in — AttendAI" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
  component: CheckInPage,
});

function CheckInPage() {
  const { session: sessionId } = Route.useSearch();
  const router = useRouter();

  const { user, login } = useAuth();

  const [session, setSession] = useState<QRSession | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [result, setResult] = useState<QRCheckIn | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [classStudents, setClassStudents] = useState<Student[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    console.log("[QR CLIENT] received session parameter:", sessionId);
    console.log("[QR CLIENT] requesting session from server...");

    Promise.all([qrService.getSession(sessionId), studentService.getAll()])
      .then(([sess, allStudents]) => {
        console.log("[QR CLIENT] server returned session:", sess);
        if (sess) {
          setSession(sess);
          setClassStudents(allStudents.filter((s) => s.className === sess.className));

          if (user?.studentId) {
            // Find the authenticated student's record
            const found = allStudents.find((s) => s.id === user.studentId);
            if (found) {
              setStudent(found);
            }
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch session", err);
        setLoading(false);
      });
  }, [sessionId, user]);

  const handleCheckIn = async () => {
    if (!sessionId || !student) return;

    setCheckingIn(true);
    setErrorMsg(null);

    try {
      // Simulate capturing proximity data (GPS/Network)
      const mockLocationData = {
        lat: 17.385,
        lng: 78.4867,
        bssid: "00:14:22:01:23:45",
      };

      const checkInResult = await qrService.checkIn(sessionId, student.id, mockLocationData);
      setResult(checkInResult);
      toast.success("Check-in successful");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Check-in failed";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setCheckingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center p-4 bg-muted/20">
        <div className="w-full max-w-md text-center space-y-6">
          <h1 className="font-display text-2xl font-bold tracking-tight">AttendAI Check-in</h1>
          <Card className="card-elevated shadow-lg overflow-hidden">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <QrCode className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl">Scan to Check In</CardTitle>
              <CardDescription>
                Point your camera at the QR code displayed by your faculty.
              </CardDescription>
            </CardHeader>
            <div className="relative aspect-square w-full bg-black">
              <Scanner
                onScan={(detectedCodes) => {
                  if (detectedCodes && detectedCodes.length > 0) {
                    const rawValue = detectedCodes[0]?.rawValue;
                    if (!rawValue) return;
                    try {
                      const url = rawValue.startsWith("http")
                        ? new URL(rawValue)
                        : new URL(rawValue, window.location.origin);
                      const sessionParam = url.searchParams.get("session");
                      if (sessionParam) {
                        router.navigate({ to: "/check-in", search: { session: sessionParam } });
                      } else {
                        toast.error("Invalid QR code: No session data");
                      }
                    } catch (e) {
                      toast.error("Invalid QR code format");
                    }
                  }
                }}
                onError={(err) => {
                  console.error(err);
                }}
              />
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!session || !session.active) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-4">
        <Card className="w-full max-w-md border-destructive/30 bg-destructive/5 text-center">
          <CardHeader>
            <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
            <CardTitle className="mt-4">Invalid Session</CardTitle>
            <CardDescription>
              This QR code is invalid, expired, or the session has been closed by the faculty.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center p-4 bg-muted/20">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">AttendAI Check-in</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {session.className} · {session.date}
          </p>
        </div>

        {user && ["faculty", "admin", "staff"].includes(user.role) ? (
          <Card className="border-destructive/30 bg-destructive/5 text-center">
            <CardHeader>
              <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
              <CardTitle className="mt-4">Faculty Account Detected</CardTitle>
              <CardDescription>
                You are currently logged in as {user.name} ({user.role}). Students must not use
                Faculty devices to check in.
                <br />
                <br />
                To test the student flow, please open this link in an incognito window.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : !user ? (
          <Card className="card-elevated shadow-lg">
            <CardHeader>
              <CardTitle>Select Your Profile</CardTitle>
              <CardDescription>
                (Demo Mode) Select your name to authenticate as a student for {session.className}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                {classStudents.map((s) => (
                  <Button
                    key={s.id}
                    variant="outline"
                    className="w-full justify-start h-auto py-3"
                    onClick={async () => {
                      try {
                        const dbUsers = await userRepository.findAll();
                        const mockUser = dbUsers.find((u) => u.studentId === s.id);
                        if (mockUser && login) {
                          await login(mockUser.id);
                        } else {
                          toast.error("Mock user not found for this student");
                        }
                      } catch (e) {
                        toast.error("Failed to authenticate as student");
                      }
                    }}
                  >
                    <div className="text-left">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.roll}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : result ? (
          <Card className="border-success/30 bg-success/5">
            <CardHeader className="text-center pb-4">
              <CheckCircle2 className="mx-auto h-16 w-16 text-success" />
              <CardTitle className="mt-4 text-xl">You're checked in!</CardTitle>
              <CardDescription>Your proximity and identity were verified securely.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card className="card-elevated shadow-lg">
            <CardHeader>
              <CardTitle>Confirm Check-in</CardTitle>
              <CardDescription>
                You are checking in as <strong>{student?.name}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {errorMsg && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive flex gap-2 items-start">
                  <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>{errorMsg}</p>
                </div>
              )}

              <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="h-4 w-4" />
                  <span className="font-medium text-foreground">Proximity Active</span>
                </div>
                <p className="text-xs">
                  Your location and network connection will be verified against the classroom's
                  signature to prevent proxy attendance.
                </p>
              </div>

              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={handleCheckIn}
                disabled={!student || checkingIn}
              >
                {checkingIn ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Smartphone className="mr-2 h-5 w-5" />
                    Slide to Check In
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
