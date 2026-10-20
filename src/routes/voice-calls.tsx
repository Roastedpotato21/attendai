import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PhoneCall, RefreshCw, Languages, CheckCircle2 } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CallRecord, KPIs } from "@/lib/types";
import { communication, voiceCallService, studentService } from "@/lib/services";

export const Route = createFileRoute("/voice-calls")({
  head: () => ({
    meta: [
      { title: "AI Voice Calls — AttendAI" },
      {
        name: "description",
        content:
          "Voice-call history and simulation records. Conversational parent calls require a separately provisioned speech runtime.",
      },
      { property: "og:title", content: "AI Voice Calls — AttendAI" },
      {
        property: "og:description",
        content:
          "Call status and simulation history; conversational voice is not enabled in this deployment.",
      },
    ],
  }),
  component: VoiceCallsPage,
});

function VoiceCallsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState<CallRecord | undefined>(undefined);

  useEffect(() => {
    studentService.getKPIs().then(setKpis);
    voiceCallService.getAll().then((data) => {
      setCalls(data);
      if (data.length > 0) setActive(data[0]);
    });
  }, []);

  const filtered = filter === "all" ? calls : calls.filter((c) => c.status === filter);

  const retry = async (call: CallRecord) => {
    toast.loading("Scheduling retry…", { id: call.id });
    try {
      const res = await voiceCallService.retry(call.id);
      setCalls((prev) =>
        prev.map((c) =>
          c.id === call.id ? { ...c, attempts: c.attempts + 1, status: "scheduled" } : c,
        ),
      );
      toast.success(`Retry queued for ${call.student}`, { id: call.id, description: res.note });
    } catch (error) {
      console.error("Call retry failed:", error);
      toast.error(`Failed to retry call for ${call.student}`, { id: call.id });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="AI Voice Calls"
        description="Recorded call history. Manual voice outreach is currently unavailable."
        actions={
          <Button onClick={() => toast.info("Manual call batches are not available.")}>
            <PhoneCall className="mr-2 h-4 w-4" />
            Start call batch
          </Button>
        }
      />

      {kpis && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Calls today"
            value={String(kpis.callsToday)}
            icon={<PhoneCall className="h-5 w-5" />}
          />
          <StatCard
            label="Completed"
            value={kpis.callSuccess === null ? "No calls" : `${kpis.callSuccess}%`}
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
          <StatCard
            label="Voice outreach"
            value="Unavailable"

            icon={<Languages className="h-5 w-5" />}
          />
          <StatCard
            label="Retries pending"
            value={String(calls.filter((call) => call.status === "scheduled").length)}
            trend="down"
            icon={<RefreshCw className="h-5 w-5" />}
          />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-2">
          <CardHeader>
            <CardTitle>Call log</CardTitle>
            <CardDescription>{filtered.length} calls</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={filter} onValueChange={setFilter} className="mb-4">
              <TabsList className="flex-wrap">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="completed">Completed</TabsTrigger>
                <TabsTrigger value="no-answer">No answer</TabsTrigger>
                <TabsTrigger value="failed">Failed</TabsTrigger>
                <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-2">
              {filtered.slice(0, 10).map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActive(c)}
                  onKeyDown={(e) => e.key === "Enter" && setActive(c)}
                  className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.student}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.parent} · {c.language} · {c.startedAt} · {c.attempts} attempt(s)
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill tone={toneForStatus(c.status)}>{c.status}</StatusPill>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        void retry(c);
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Call detail</CardTitle>
            <CardDescription>{active ? active.id : "Select a call"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {active ? (
              <>
                <DetailRow label="Student" value={active.student} />
                <DetailRow label="Parent" value={active.parent} />
                <DetailRow label="Language" value={active.language} />
                <DetailRow
                  label="Duration"
                  value={active.durationSec ? `${active.durationSec}s` : "—"}
                />
                <DetailRow label="Sentiment" value={active.sentiment} />
                <Separator />
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Parent response
                  </p>
                  <p className="mt-1 rounded-lg bg-muted p-3 text-sm">{active.parentResponse}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    AI summary
                  </p>
                  <p className="mt-1 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    {active.aiSummary}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => toast.info("Faculty summary notifications are not available.")}
                >
                  Notify faculty
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">Pick a call from the log.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
