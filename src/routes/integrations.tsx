import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plug, ShieldCheck, Zap, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard, StatusPill } from "@/components/common/page-parts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Integration } from "@/lib/types";
import { integrationsService } from "@/lib/services";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — AttendAI" },
      {
        name: "description",
        content:
          "Connect voice, SMS, WhatsApp and ERP providers. AttendAI runs in simulation mode until configured.",
      },
      { property: "og:title", content: "Integrations — AttendAI" },
      { property: "og:description", content: "Voice, messaging, AI and ERP provider connections." },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  useEffect(() => {
    integrationsService.getAll().then(setIntegrations);
  }, []);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Integrations"
        description="Provider slots are wired end-to-end — connect credentials to switch off simulation mode."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available"
          value={String(integrations.length)}
          icon={<Plug className="h-5 w-5" />}
        />
        <StatCard
          label="Connected"
          value="0"
          trend="flat"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Mode"
          value="Simulation"
          trend="flat"
          icon={<AlertCircle className="h-5 w-5" />}
        />
        <StatCard label="Webhooks ready" value="4" icon={<Zap className="h-5 w-5" />} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((i) => (
          <Card key={i.id} className="card-elevated">
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{i.name}</CardTitle>
                <CardDescription>{i.category}</CardDescription>
              </div>
              <StatusPill tone="warning">Not connected</StatusPill>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{i.description}</p>
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => toast.info(`${i.name} connection flow is not enabled in this build`)}
              >
                Connect
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
