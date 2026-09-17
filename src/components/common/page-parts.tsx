import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  delta,
  trend = "up",
  icon,
  hint,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "flat";
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="card-elevated overflow-hidden transition-transform duration-300 hover:-translate-y-0.5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
        {delta && (
          <p
            className={cn(
              "mt-3 text-xs font-medium",
              trend === "up" && "text-success",
              trend === "down" && "text-destructive",
              trend === "flat" && "text-muted-foreground",
            )}
          >
            {delta}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// StatusPill — typed tone keys
// ---------------------------------------------------------------------------

export type StatusTone = "success" | "warning" | "danger" | "info" | "muted";

const tones: Record<StatusTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-info/30 bg-info/10 text-info",
  muted: "border-border bg-muted text-muted-foreground",
};

export function StatusPill({
  tone = "muted",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("font-medium", tones[tone])}>
      {children}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// toneForStatus — maps domain status strings to StatusTone
// ---------------------------------------------------------------------------

const successStatuses = new Set([
  "present",
  "delivered",
  "read",
  "completed",
  "resolved",
  "low",
  "cooperative",
]);
const warningStatuses = new Set([
  "late",
  "sent",
  "in-progress",
  "acknowledged",
  "medium",
  "scheduled",
  "concerned",
  "neutral",
  "warning",
]);
const dangerStatuses = new Set([
  "absent",
  "failed",
  "no-answer",
  "open",
  "high",
  "unreachable",
  "critical",
]);

export function toneForStatus(status: string): StatusTone {
  if (successStatuses.has(status)) return "success";
  if (warningStatuses.has(status)) return "warning";
  if (dangerStatuses.has(status)) return "danger";
  if (status === "unmarked") return "muted";
  return "info";
}

// ---------------------------------------------------------------------------
// DetailRow — shared key/value row (was duplicated as Detail and Row)
// ---------------------------------------------------------------------------

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}
