import { useEffect, useState } from "react";
import { academicRpc } from "@/lib/services/student-academics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Configuration = { enabled: boolean; can_configure: boolean; summary_local_time: string };
export function PeriodNotificationSettings({
  institution,
  timezone,
}: {
  institution: string;
  timezone: string;
}) {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [saved, setSaved] = useState<Configuration | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void academicRpc<Configuration>("period_notification_configuration", {
      p_institution: institution,
    })
      .then((c) => {
        if (live) {
          setConfig(c);
          setSaved(c);
        }
      })
      .catch(() => {
        if (live) setError("Notification configuration is unavailable.");
      });
    return () => {
      live = false;
    };
  }, [institution]);
  if (!config)
    return <p role={error ? "alert" : "status"}>{error || "Loading notification settings…"}</p>;
  return (
    <section className="space-y-2 rounded border p-3" aria-label="Guardian alert settings">
      <h2 className="font-semibold">Guardian attendance alerts</h2>
      <p>
        {saved?.enabled ? "Enabled" : "Disabled"}. Daily summary:{" "}
        {saved?.summary_local_time.slice(0, 5)} ({timezone}). Only locked absences are eligible. A
        configured server worker must run to process notices.
      </p>
      {config.can_configure && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await academicRpc("set_period_notification_settings", {
                p_institution: institution,
                p_enabled: config.enabled,
                p_summary_time: config.summary_local_time,
              });
              setSaved(config);
              setNotice("Notification settings saved. This does not send a notification.");
            } catch {
              setError("Could not save notification settings. Refresh and try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={busy}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            Enable guardian attendance alerts
          </label>
          <label className="block">
            Daily summary local time
            <Input
              aria-label="Daily summary local time"
              type="time"
              required
              disabled={busy}
              value={config.summary_local_time.slice(0, 5)}
              onChange={(e) => setConfig({ ...config, summary_local_time: e.target.value })}
            />
          </label>
          <Button disabled={busy}>Save notification settings</Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {saved &&
        (saved.enabled !== config.enabled ||
          saved.summary_local_time !== config.summary_local_time) && (
          <p>Unsaved notification settings.</p>
        )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

type Notice = {
  student_id: string;
  kind: string;
  state: string;
  event_id: string;
  created_at: string;
};
export function PeriodNotificationStatus({
  session,
  revision,
  names,
}: {
  session: string;
  revision: number;
  names: Record<string, string>;
}) {
  const [rows, setRows] = useState<Notice[] | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    void academicRpc<Notice[]>("period_notification_status", { p_session: session })
      .then((result) => {
        if (live) {
          setRows(result);
          setError("");
        }
      })
      .catch(() => {
        if (live) setError("Notification status is unavailable.");
      });
    return () => {
      live = false;
    };
  }, [session, revision, refresh]);
  return (
    <section aria-label="Guardian notification status" className="space-y-2 rounded border p-3">
      <h3 className="font-semibold">Guardian notification status for this student day</h3>
      <p>
        Provider accepted means FCM accepted the request. Device acknowledgment is recorded
        separately.
      </p>
      <Button variant="outline" onClick={() => setRefresh((x) => x + 1)}>
        Refresh notification status
      </Button>
      {error ? (
        <p role="alert">{error}</p>
      ) : rows === null ? (
        <p>Loading notification status…</p>
      ) : rows.length === 0 ? (
        <p>
          No notification events recorded. Pending sessions and grace-period marks are not eligible.
        </p>
      ) : (
        <ul>
          {rows.map((row, i) => (
            <li key={`${row.event_id}:${i}`}>
              {names[row.student_id] ?? "Student"}: {row.kind.replaceAll("_", " ")} —{" "}
              {row.state.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
