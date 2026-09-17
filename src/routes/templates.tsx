import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Plus, Languages, Bot } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard, StatusPill } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Template } from "@/lib/types";
import { templateService } from "@/lib/services";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Message & Voice Templates — AttendAI" },
      {
        name: "description",
        content:
          "Multilingual SMS, WhatsApp and AI voice script templates with variables and activation controls.",
      },
      { property: "og:title", content: "Templates — AttendAI" },
      { property: "og:description", content: "Multilingual messaging and voice-script templates." },
    ],
  }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const [items, setItems] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | undefined>(undefined);

  useEffect(() => {
    templateService.getAll().then((data) => {
      setItems(data);
      if (data.length > 0) setEditing(data[0]);
    });
  }, []);

  const toggle = async (id: string) => {
    toast.loading("Updating status...", { id: "toggle" });
    try {
      const updated = await templateService.toggleActive(id);
      setItems((prev) => prev.map((t) => (t.id === id ? updated : t)));
      toast.success("Template updated", { id: "toggle" });
    } catch (error) {
      console.error("Toggle failed:", error);
      toast.error("Failed to update template", { id: "toggle" });
    }
  };

  const saveTemplate = async () => {
    if (!editing) return;
    toast.loading("Saving...", { id: "save" });
    try {
      const updated = await templateService.update(editing);
      setItems((prev) => prev.map((t) => (t.id === editing.id ? updated : t)));
      toast.success("Template saved", { id: "save" });
    } catch (error) {
      console.error("Save failed:", error);
      toast.error("Failed to save template", { id: "save" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Templates"
        description="One message, every language — with variables resolved per student and parent."
        actions={
          <Button onClick={() => toast.success("New template draft created")}>
            <Plus className="mr-2 h-4 w-4" />
            New template
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Templates"
          value={String(items.length)}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          label="Active"
          value={String(items.filter((t) => t.active).length)}
          icon={<Bot className="h-5 w-5" />}
        />
        <StatCard label="Languages" value="6" icon={<Languages className="h-5 w-5" />} />
        <StatCard
          label="Voice scripts"
          value={String(items.filter((t) => t.channel === "Voice").length)}
          trend="flat"
          icon={<Bot className="h-5 w-5" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {items.map((t) => (
            <Card key={t.id} className="card-elevated cursor-pointer" onClick={() => setEditing(t)}>
              <CardContent className="p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {t.name} <span className="text-muted-foreground">· {t.language}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.channel} · updated {t.updatedAt}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusPill tone={t.channel === "Voice" ? "info" : "success"}>
                      {t.channel}
                    </StatusPill>
                    <Switch
                      checked={t.active}
                      onCheckedChange={(checked) => {
                        void toggle(t.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="card-elevated h-fit">
          <CardHeader>
            <CardTitle>Editor</CardTitle>
            <CardDescription>
              {editing ? `${editing.name} · ${editing.language}` : "Select a template"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={10}
              value={editing?.body ?? ""}
              onChange={(e) =>
                setEditing((prev) => (prev ? { ...prev, body: e.target.value } : prev))
              }
            />
            <p className="text-xs text-muted-foreground">
              Variables: {"{{student_name}}"}, {"{{parent_name}}"}, {"{{class}}"}, {"{{date}}"},{" "}
              {"{{attendance_rate}}"}, {"{{school_name}}"}
            </p>
            <Button className="w-full" onClick={saveTemplate}>
              Save template
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
