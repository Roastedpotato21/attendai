import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, UserCog, KeyRound, Lock } from "lucide-react";

import { PageHeader, StatCard, StatusPill } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RolesMatrixRow } from "@/lib/types";
import { rolesService } from "@/lib/services";

export const Route = createFileRoute("/roles")({
  head: () => ({
    meta: [
      { title: "Roles & Permissions — AttendAI" },
      {
        name: "description",
        content:
          "Role-based access control across attendance, students, AI outreach, reports and settings.",
      },
      { property: "og:title", content: "Roles & Permissions — AttendAI" },
      {
        property: "og:description",
        content: "RBAC matrix for admins, HODs, class teachers and faculty.",
      },
    ],
  }),
  component: RolesPage,
});

const columns = ["attendance", "students", "ai", "reports", "settings"] as const;

function RolesPage() {
  const [rolesMatrix, setRolesMatrix] = useState<RolesMatrixRow[]>([]);

  useEffect(() => {
    rolesService.getMatrix().then(setRolesMatrix);
  }, []);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Roles & Permissions"
        description="Least-privilege access for every person touching student and parent data."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Roles"
          value={String(rolesMatrix.length)}
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <StatCard label="Users" value="38" icon={<UserCog className="h-5 w-5" />} />
        <StatCard label="MFA enforced" value="Yes" icon={<KeyRound className="h-5 w-5" />} />
        <StatCard
          label="Data scopes"
          value="Class-level"
          trend="flat"
          icon={<Lock className="h-5 w-5" />}
        />
      </div>

      <Card className="card-elevated mt-4">
        <CardHeader>
          <CardTitle>Permission matrix</CardTitle>
          <CardDescription>Applies to every module in AttendAI</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Attendance</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead>AI outreach</TableHead>
                  <TableHead>Reports</TableHead>
                  <TableHead>Settings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rolesMatrix.map((r) => (
                  <TableRow key={r.role}>
                    <TableCell className="font-medium">{r.role}</TableCell>
                    {columns.map((c) => (
                      <TableCell key={c}>
                        <StatusPill
                          tone={
                            r[c] === "Full" ? "success" : r[c] === "None" ? "danger" : "warning"
                          }
                        >
                          {r[c]}
                        </StatusPill>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
