import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GraduationCap, Users, BookOpen, Bell, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard, StatusPill } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-context";
import { hasDatabaseConnection, supabase } from "@/lib/db/connection";
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

type StaffAccount = {
  id: string;
  name: string;
  email: string;
  role: "faculty" | "staff";
  membershipStatus: "invited" | "active" | "inactive" | "suspended" | "revoked";
  invitedAt: string | null;
};

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
  const { user } = useAuth();
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [classAttendance, setClassAttendance] = useState<ClassAttendance[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"faculty" | "staff">("faculty");
  const [isInviting, setIsInviting] = useState(false);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  const loadStaffAccounts = useCallback(async () => {
    if (!hasDatabaseConnection() || !supabase || user?.role !== "admin") return;
    setStaffLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const response = await fetch("/api/admin/staff", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const result = (await response.json()) as { staff?: StaffAccount[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to load staff accounts.");
      setStaffAccounts(result.staff ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load staff accounts.");
    } finally {
      setStaffLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    facultyService.getAll().then(setFaculty);
    attendanceService.getClassAttendance().then(setClassAttendance);
  }, []);

  useEffect(() => {
    void loadStaffAccounts();
  }, [loadStaffAccounts]);

  const sendInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasDatabaseConnection() || !supabase) {
      toast.error("Staff invitations require a connected Supabase environment.");
      return;
    }
    setIsInviting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch("/api/admin/staff-invitations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: inviteName, email: inviteEmail, role: inviteRole }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to send invitation.");
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteName("");
      setInviteEmail("");
      setInviteRole("faculty");
      setInviteOpen(false);
      await loadStaffAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send invitation.");
    } finally {
      setIsInviting(false);
    }
  };

  const manageStaff = async (
    profileId: string,
    action: "suspend" | "reactivate" | "revoke" | "resend" | "set_role",
    role?: "faculty" | "staff",
  ) => {
    if (!supabase) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ profileId, action, ...(role ? { role } : {}) }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to update staff access.");
      toast.success(action === "resend" ? "Invitation resent." : "Staff access updated.");
      await loadStaffAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update staff access.");
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Faculty & Classes"
        description="Who owns each class and who gets notified when AI finishes a parent conversation."
        actions={
          user?.role === "admin" ? (
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Invite staff
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={sendInvite}>
                  <DialogHeader>
                    <DialogTitle>Invite faculty or staff</DialogTitle>
                    <DialogDescription>
                      AttendAI will email a secure link to verify their address and create a
                      password.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-name">Full name</Label>
                      <Input
                        id="invite-name"
                        value={inviteName}
                        onChange={(event) => setInviteName(event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        autoComplete="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-role">AttendAI role</Label>
                      <Select
                        value={inviteRole}
                        onValueChange={(value) => setInviteRole(value as "faculty" | "staff")}
                      >
                        <SelectTrigger id="invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="faculty">Faculty</SelectItem>
                          <SelectItem value="staff">Staff</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={isInviting}>
                      {isInviting ? "Sending…" : "Send invitation"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : undefined
        }
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
                          onClick={() => toast.info("Faculty digests are not available.")}
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

      {user?.role === "admin" && hasDatabaseConnection() && (
        <Card className="card-elevated mt-4">
          <CardHeader>
            <CardTitle>Staff access</CardTitle>
            <CardDescription>
              Pending invitations do not have portal access until the recipient finishes setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffAccounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <p className="font-medium">{account.name}</p>
                        <p className="text-xs text-muted-foreground">{account.email}</p>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={account.role}
                          onValueChange={(value) =>
                            void manageStaff(account.id, "set_role", value as "faculty" | "staff")
                          }
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="faculty">Faculty</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          tone={
                            account.membershipStatus === "active"
                              ? "success"
                              : account.membershipStatus === "invited"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {account.membershipStatus}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {account.membershipStatus === "invited" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void manageStaff(account.id, "resend")}
                          >
                            Resend
                          </Button>
                        )}
                        {account.membershipStatus === "active" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void manageStaff(account.id, "suspend")}
                          >
                            Suspend
                          </Button>
                        ) : (
                          account.membershipStatus !== "revoked" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void manageStaff(account.id, "reactivate")}
                            >
                              Reactivate
                            </Button>
                          )
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void manageStaff(account.id, "revoke")}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!staffLoading && staffAccounts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No invited staff yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
