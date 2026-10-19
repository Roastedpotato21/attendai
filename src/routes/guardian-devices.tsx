import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import QRCode from "react-qr-code";

import { PageHeader } from "@/components/common/page-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/db/connection";

export const Route = createFileRoute("/guardian-devices")({
  head: () => ({ meta: [{ title: "Guardian devices — AttendAI" }] }),
  component: GuardianDevices,
});

type Device = {
  id: string;
  active: boolean;
  permission: string;
  consent: boolean;
  registeredAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};
type Guardian = {
  id: string;
  name: string;
  communicationConsent: boolean;
  active: boolean;
  students: { name: string; receivesNotifications: boolean }[];
  devices: Device[];
};

async function api(method: "GET" | "POST", input?: Record<string, string>) {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error("Sign in to manage guardian devices");
  const response = await fetch("/api/admin/guardian-notifications", {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(input ? { "content-type": "application/json" } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  if (!response.ok) {
    const result = (await response.json()) as { error?: string };
    throw new Error(result.error ?? "Guardian devices could not be updated");
  }
  return response.json() as Promise<{ guardians?: Guardian[]; link?: string }>;
}

function GuardianDevices() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      setGuardians((await api("GET")).guardians ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load guardians");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const invite = async (guardianId: string) => {
    setBusy(guardianId);
    setLink(null);
    try {
      const result = await api("POST", { action: "invite", guardianId });
      setLink(result.link ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create link");
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (installationId: string) => {
    setBusy(installationId);
    try {
      await api("POST", { action: "revoke", installationId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke device");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="Guardian notification devices"
        description="Generate a private consent link for a guardian's linked students, then manage each enrolled device."
      />
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {link && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enrollment link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              Share this link privately. It expires in 15 minutes and works once.
            </p>
            <div className="inline-block rounded-md bg-white p-3">
              <QRCode value={link} size={180} title="Scan to enroll your phone for notifications" />
            </div>
            <p className="text-sm">
              Scan on the parent's phone, open in Chrome on Android, check the consent box, then tap
              Enable Notifications and Allow. Each phone needs its own link and consent.
            </p>
            <p className="break-all rounded-md bg-muted p-3 text-xs">{link}</p>
            <Button variant="outline" onClick={() => void navigator.clipboard.writeText(link)}>
              Copy link
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {guardians.map((guardian) => {
          const active = guardian.devices.filter(
            (device) =>
              device.active &&
              !device.revokedAt &&
              device.permission === "granted" &&
              device.consent,
          );
          return (
            <Card key={guardian.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <Bell className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{guardian.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {guardian.communicationConsent
                      ? "Communication consent recorded"
                      : "Communication consent is off"}{" "}
                    ·{" "}
                    {active.length
                      ? `${active.length} active device${active.length === 1 ? "" : "s"}`
                      : "No device ready for notifications"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Linked students:{" "}
                    {guardian.students?.length
                      ? guardian.students
                          .map(
                            (student) =>
                              `${student.name}${student.receivesNotifications ? "" : " (alerts off)"}`,
                          )
                          .join(", ")
                      : "None"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Notification consent:{" "}
                    {guardian.devices.some((device) => device.consent && device.active)
                      ? "Recorded"
                      : "Not recorded for an active device"}
                  </p>
                  {guardian.devices.map((device, index) => (
                    <p key={device.id} className="text-xs text-muted-foreground">
                      Device {index + 1}:{" "}
                      {device.active && !device.revokedAt ? "active" : "revoked"}; consent{" "}
                      {device.consent ? "recorded" : "required"}; registered{" "}
                      {new Date(device.registeredAt).toLocaleDateString()}; last seen{" "}
                      {new Date(device.lastSeenAt).toLocaleDateString()}
                    </p>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !guardian.active || !guardian.communicationConsent}
                  onClick={() => void invite(guardian.id)}
                >
                  Create enrollment link
                </Button>
                {guardian.devices
                  .filter((device) => device.active && !device.revokedAt)
                  .map((device, index) => (
                    <Button
                      key={device.id}
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => void revoke(device.id)}
                    >
                      Revoke device {index + 1}
                    </Button>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
