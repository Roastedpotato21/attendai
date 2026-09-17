import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollText, ShieldAlert, Activity, Search } from "lucide-react";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditLog } from "@/lib/types";
import { auditService } from "@/lib/services";

export const Route = createFileRoute("/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Logs — AttendAI" },
      {
        name: "description",
        content:
          "Immutable trail of attendance edits, AI outreach triggers, template changes and permission updates.",
      },
      { property: "og:title", content: "Audit Logs — AttendAI" },
      {
        property: "og:description",
        content: "Compliance-grade activity trail across the platform.",
      },
    ],
  }),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    auditService.getAll().then(setAuditLogs);
  }, []);

  const filtered = auditLogs.filter(
    (l) =>
      l.actor.toLowerCase().includes(query.toLowerCase()) ||
      l.action.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Audit Logs"
        description="Every privileged action is recorded for compliance reviews."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Events today"
          value={String(auditLogs.length)}
          icon={<ScrollText className="h-5 w-5" />}
        />
        <StatCard
          label="Critical"
          value={String(auditLogs.filter((l) => l.severity === "critical").length)}
          trend="down"
          icon={<ShieldAlert className="h-5 w-5" />}
        />
        <StatCard
          label="Unique actors"
          value={String(new Set(auditLogs.map((l) => l.actor)).size)}
          icon={<Activity className="h-5 w-5" />}
        />
        <StatCard
          label="Retention"
          value="365 days"
          trend="flat"
          icon={<Search className="h-5 w-5" />}
        />
      </div>

      <Card className="card-elevated mt-4">
        <CardHeader>
          <CardTitle>Activity trail</CardTitle>
          <CardDescription>{filtered.length} events</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Search actor or action"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-4 h-9 w-full sm:max-w-sm"
          />
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Target</TableHead>
                  <TableHead className="hidden lg:table-cell">IP</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs">{l.at}</TableCell>
                    <TableCell className="text-sm font-medium">{l.actor}</TableCell>
                    <TableCell className="text-sm">{l.action}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs">{l.target}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">{l.ip}</TableCell>
                    <TableCell>
                      <StatusPill tone={toneForStatus(l.severity)}>{l.severity}</StatusPill>
                    </TableCell>
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
