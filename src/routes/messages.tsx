import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare, Send, CheckCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard, StatusPill, toneForStatus } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import type { Language, MessageRecord, KPIs } from "@/lib/types";
import { communication, messageService, studentService } from "@/lib/services";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { title: "SMS & WhatsApp Outreach — AttendAI" },
      {
        name: "description",
        content:
          "Multilingual SMS and WhatsApp absence alerts to parents with delivery status and replies.",
      },
      { property: "og:title", content: "SMS & WhatsApp Outreach — AttendAI" },
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
  const [kpis, setKpis] = useState<KPIs | null>(null);

  const [channel, setChannel] = useState<"SMS" | "WhatsApp">("WhatsApp");
  const [language, setLanguage] = useState<Language>("Telugu");
  const [body, setBody] = useState(
    "ప్రియమైన తల్లిదండ్రులకు, {{student_name}} ఈరోజు హాజరు కాలేదు. దయచేసి కారణం తెలియజేయండి. — AttendAI",
  );
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    messageService.getAll().then(setMessages);
    studentService.getKPIs().then(setKpis);
  }, []);

  const filtered = filter === "all" ? messages : messages.filter((m) => m.channel === filter);

  const send = async () => {
    toast.loading("Sending broadcast…", { id: "send" });
    try {
      const res = await messageService.send({
        to: "+91 90000 00000",
        channel,
        language,
        templateId: "custom",
        variables: {},
      });
      toast.success(`Broadcast queued via ${channel} (${language})`, {
        id: "send",
        description: res.note,
      });
    } catch (error) {
      console.error("Broadcast send failed:", error);
      toast.error("Failed to send broadcast — please try again", { id: "send" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="SMS / WhatsApp"
        description="Template-driven parent messaging in the language each family actually reads."
      />

      {kpis && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Messages sent"
            value={String(kpis.messagesSent)}
            icon={<MessageSquare className="h-5 w-5" />}
          />
          <StatCard
            label="Delivered"
            value="94.1%"
            delta="+2.1%"
            icon={<CheckCheck className="h-5 w-5" />}
          />
          <StatCard
            label="Replies"
            value="188"
            hint="Two-way WhatsApp"
            icon={<Send className="h-5 w-5" />}
          />
          <StatCard label="Failed" value="9" trend="down" icon={<XCircle className="h-5 w-5" />} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="card-elevated lg:col-span-2">
          <CardHeader>
            <CardTitle>Message log</CardTitle>
            <CardDescription>{filtered.length} messages today</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={filter} onValueChange={setFilter} className="mb-4">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="WhatsApp">WhatsApp</TabsTrigger>
                <TabsTrigger value="SMS">SMS</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="space-y-2">
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
                    <StatusPill tone={toneForStatus(m.status)}>{m.status}</StatusPill>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Compose broadcast</CardTitle>
            <CardDescription>Sent to all absentees in the selected view</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as "SMS" | "WhatsApp")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="SMS">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Variables: {"{{student_name}}"}, {"{{parent_name}}"}, {"{{date}}"}
              </p>
            </div>
            <Button className="w-full" onClick={send}>
              <Send className="mr-2 h-4 w-4" />
              Send broadcast
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
