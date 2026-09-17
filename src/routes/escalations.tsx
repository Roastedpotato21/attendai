import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlert, ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Escalation } from "@/lib/types";
import { ESCALATION_LEVELS } from "@/lib/config";
import { escalationService } from "@/lib/services";

export const Route = createFileRoute("/escalations")({
  head: () => ({
    meta: [
      { title: "Escalations — AttendAI" },
      {
        name: "description",
        content:
          "Four-level escalation workflow from faculty follow-up to principal review for chronic absentees.",
      },
      { property: "og:title", content: "Escalations — AttendAI" },
      {
        property: "og:description",
        content: "L1–L4 escalation tracking for chronic absence cases.",
      },
    ],
  }),
  component: EscalationsPage,
});

const levels = ESCALATION_LEVELS;

function EscalationsPage() {
  const [items, setItems] = useState<Escalation[]>([]);

  useEffect(() => {
    escalationService.getAll().then(setItems);
  }, []);

  const advance = async (id: string) => {
    toast.loading("Escalating...", { id: "escalate" });
    try {
      const updated = await escalationService.escalate(id);
      setItems((prev) => prev.map((e) => (e.id === id ? updated : e)));
      toast.success("Escalated to the next level", { id: "escalate" });
    } catch (error) {
      console.error("Escalation failed:", error);
      toast.error("Failed to escalate", { id: "escalate" });
    }
  };

  const resolve = async (id: string) => {
    toast.loading("Resolving...", { id: "resolve" });
    try {
      const updated = await escalationService.resolve(id);
      setItems((prev) => prev.map((e) => (e.id === id ? updated : e)));
      toast.success("Escalation resolved", { id: "resolve" });
    } catch (error) {
      console.error("Resolution failed:", error);
      toast.error("Failed to resolve", { id: "resolve" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Escalations"
        description="When AI outreach doesn't resolve an absence, cases move up the chain automatically."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open"
          value={String(items.filter((e) => e.status === "open").length)}
          trend="down"
          icon={<TriangleAlert className="h-5 w-5" />}
        />
        <StatCard
          label="Acknowledged"
          value={String(items.filter((e) => e.status === "acknowledged").length)}
          trend="flat"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Resolved"
          value={String(items.filter((e) => e.status === "resolved").length)}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="At L4"
          value={String(items.filter((e) => e.level === "L4 Principal").length)}
          trend="down"
          icon={<ShieldAlert className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {levels.map((level) => (
          <Card key={level} className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">{level}</CardTitle>
              <CardDescription>
                {items.filter((e) => e.level === level).length} cases
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {items
                .filter((e) => e.level === level)
                .map((e) => (
                  <div key={e.id} className="rounded-xl border p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <p className="truncate text-sm font-medium">{e.student}</p>
                      <StatusPill tone={toneForStatus(e.status)}>{e.status}</StatusPill>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.className} · {e.raisedAt}
                    </p>
                    <p className="mt-2 text-xs">{e.reason}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Owner: {e.owner}</p>
                    {e.status !== "resolved" && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => advance(e.id)}
                        >
                          Escalate
                        </Button>
                        <Button size="sm" className="flex-1" onClick={() => resolve(e.id)}>
                          Resolve
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              {items.filter((e) => e.level === level).length === 0 && (
                <p className="text-xs text-muted-foreground">No cases at this level.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
