import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare, CheckCheck, XCircle, AlertCircle } from "lucide-react";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MessageRecord } from "@/lib/types";
import { messageService } from "@/lib/services";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { title: "Guardian messages — AttendAI" },
      {
        name: "description",
        content: "Guardian push alerts and historical SMS and WhatsApp outreach.",
      },
      { property: "og:title", content: "Guardian messages — AttendAI" },
      {
        property: "og:description",
        content: "Delivery status, templates and multilingual parent messaging.",
      },
    ],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    messageService
      .getAll()
      .then((records) => {
        if (active) setMessages(records);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = filter === "all" ? messages : messages.filter((m) => m.channel === filter);
  const delivered = messages.filter((m) => m.status === "delivered" || m.status === "read").length;
  const failed = messages.filter((m) => m.status === "failed" || m.status === "undelivered").length;
  const unconfirmed = messages.filter((m) => m.status === "unconfirmed").length;
  const displayCount = (count: number) => (error ? "—" : String(count));

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Guardian messages"
        description="SMS absence alerts, push notifications, and delivery history."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Message records"
          value={displayCount(messages.length)}
          icon={<MessageSquare className="h-5 w-5" />}
        />
        <StatCard
          label="Delivered"
          value={displayCount(delivered)}
          icon={<CheckCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Failed"
          value={displayCount(failed)}
          icon={<XCircle className="h-5 w-5" />}
        />
        <StatCard
          label="Unconfirmed"
          value={displayCount(unconfirmed)}
          icon={<AlertCircle className="h-5 w-5" />}
        />
        <StatCard
          label="Push accepted"
          value={displayCount(messages.filter((m) => m.status === "provider_accepted").length)}
          icon={<CheckCheck className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4">
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Message log</CardTitle>
            <CardDescription>
              {filtered.length} stored records{error ? " · Unable to load message history" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={filter} onValueChange={setFilter} className="mb-4">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="SMS">SMS</TabsTrigger>
                <TabsTrigger value="Push">Push</TabsTrigger>
                <TabsTrigger value="WhatsApp">WhatsApp</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="space-y-2">
              {!error && filtered.length === 0 && (
                <p className="text-sm text-muted-foreground">No messages recorded.</p>
              )}
              {filtered.slice(0, 10).map((m) => (
                <div key={m.id} className="rounded-xl border p-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.student} <span className="text-muted-foreground">· {m.template}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.channel} · {m.parentPhone} · {m.language} · {m.sentAt}
                      </p>
                    </div>
                    <StatusPill tone={toneForStatus(m.status)}>
                      {m.status === "provider_accepted"
                        ? "Push accepted"
                        : m.status === "no_registered_device"
                          ? "No registered device"
                          : m.status.replaceAll("_", " ")}
                    </StatusPill>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
