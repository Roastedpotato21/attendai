import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES } from "@/lib/config";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — AttendAI" },
      {
        name: "description",
        content:
          "Configure institution details, attendance thresholds, AI call retry policy and escalation timing.",
      },
      { property: "og:title", content: "Settings — AttendAI" },
      {
        property: "og:description",
        content: "Institution, attendance and AI outreach configuration.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [threshold, setThreshold] = useState([75]);
  const [retries, setRetries] = useState([3]);
  const [autoCall, setAutoCall] = useState(true);
  const [autoEscalate, setAutoEscalate] = useState(true);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Settings"
        description="Institution profile and the rules that drive automated parent outreach."
        actions={<Button onClick={() => toast.success("Settings saved")}>Save changes</Button>}
      />

      <div className="grid gap-4">
        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Institution</CardTitle>
            <CardDescription>Shown in messages and voice call scripts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Institution name</Label>
              <Input defaultValue="Sri Vidya Institute of Technology" />
            </div>
            <div className="space-y-1.5">
              <Label>Academic year</Label>
              <Input defaultValue="2026–27" />
            </div>
            <div className="space-y-1.5">
              <Label>Default language</Label>
              <Select defaultValue="Telugu">
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
              <Label>Timezone</Label>
              <Input defaultValue="Asia/Kolkata (IST)" />
            </div>
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>Attendance policy</CardTitle>
            <CardDescription>Thresholds that trigger warnings and escalations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <Label>Minimum attendance threshold</Label>
                <span className="text-sm font-medium">{threshold[0]}%</span>
              </div>
              <Slider
                className="mt-3"
                value={threshold}
                onValueChange={setThreshold}
                min={50}
                max={95}
                step={1}
              />
            </div>
            <Separator />
            <ToggleRow
              label="Auto-trigger AI voice calls"
              hint="Place a call when SMS/WhatsApp gets no reply within 60 minutes."
              checked={autoCall}
              onChange={setAutoCall}
            />
            <ToggleRow
              label="Auto-escalate unresolved cases"
              hint="Move to the next escalation level after 24 hours without a parent response."
              checked={autoEscalate}
              onChange={setAutoEscalate}
            />
          </CardContent>
        </Card>

        <Card className="card-elevated">
          <CardHeader>
            <CardTitle>AI outreach</CardTitle>
            <CardDescription>Retry behaviour and quiet hours</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <Label>Max call retries per absence</Label>
                <span className="text-sm font-medium">{retries[0]}</span>
              </div>
              <Slider
                className="mt-3"
                value={retries}
                onValueChange={setRetries}
                min={1}
                max={5}
                step={1}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Quiet hours start</Label>
                <Input defaultValue="21:00" />
              </div>
              <div className="space-y-1.5">
                <Label>Quiet hours end</Label>
                <Input defaultValue="08:00" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
