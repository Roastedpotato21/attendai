import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { academicRpc } from "@/lib/services/student-academics";

type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  language: string;
  contact_version: number;
};
type Link = Contact & {
  guardian_id: string;
  relationship: string;
  is_primary: boolean;
  receives_notifications: boolean;
  preferred_channel: string | null;
  effective_from: string;
  effective_until: string | null;
  status: string;
  revision: number;
  guardian_active: boolean;
  communication_consent: boolean;
  registered_devices: number;
  preference_eligible: boolean;
  can_edit_identity: boolean;
  contact_metadata: Record<string, unknown>;
  end_reason: string | null;
};
type Model = { can_manage: boolean; relationships: Link[] };
type Props = {
  studentId: string;
  reason: string;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
};
const selectStyle = "block rounded border bg-background p-2";
const empty = {
  guardian_name: "",
  guardian_mobile: "",
  guardian_email: "",
  guardian_language: "en",
  guardian_id: "",
  guardian_distinct_acknowledged: false,
};
export function StudentGuardians(props: Props) {
  const [model, setModel] = useState<Model | null>(null),
    [error, setError] = useState("");
  const [draft, setDraft] = useState({ ...empty }),
    [version, setVersion] = useState<number | null>(null),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState<Contact[]>([]);
  const [relation, setRelation] = useState({
    relationship: "guardian",
    is_primary: false,
    receives_notifications: false,
    preferred_channel: "",
    effective_from: "",
    effective_until: "",
  });
  const load = useCallback(async () => {
    setModel(await academicRpc<Model>("student_guardians", { p_student: props.studentId }));
    setError("");
  }, [props.studentId]);
  useEffect(() => {
    let live = true;
    void academicRpc<Model>("student_guardians", { p_student: props.studentId })
      .then((m) => {
        if (live) {
          setModel(m);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Guardian records unavailable.");
      });
    return () => {
      live = false;
    };
  }, [props.studentId]);
  const work = (fn: () => Promise<unknown>) =>
    props.act(async () => {
      await fn();
      await load();
    });
  const disabled = props.busy || props.reason.trim().length < 10;
  if (error)
    return (
      <section>
        <h3 className="font-semibold">Guardians</h3>
        <p role="alert">{error}</p>
      </section>
    );
  if (!model) return <p>Loading guardian relationships…</p>;
  if (!model.can_manage)
    return (
      <section>
        <h3 className="font-semibold">Guardians</h3>
        <p>
          Guardian contacts require a current student management responsibility. Teaching access
          alone does not expose contact details.
        </p>
      </section>
    );
  return (
    <section className="space-y-4" aria-label="Student guardians">
      <h3 className="text-lg font-semibold">Guardians</h3>
      <p>
        Contact records, relationship preferences, communication consent and device permission are
        separate. Adding a guardian sends no message and creates no staff account.
      </p>
      {model.relationships.map((r) => (
        <GuardianCard
          key={`${r.id}-${r.revision}-${r.contact_version}`}
          link={r}
          studentId={props.studentId}
          disabled={disabled}
          reason={props.reason}
          work={work}
        />
      ))}
      {!model.relationships.length && <p>No guardian relationships recorded.</p>}
      <details>
        <summary>Add Guardian</summary>
        <div className="space-y-3 p-3">
          <label>
            Search a reviewed existing guardian
            <Input
              aria-label="Search existing guardian"
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            disabled={props.busy || query.trim().length < 3}
            onClick={() =>
              void props.act(async () =>
                setMatches(
                  await academicRpc<Contact[]>("search_student_guardians", {
                    p_student: props.studentId,
                    p_query: query,
                  }),
                ),
              )
            }
          >
            Find guardian candidates
          </Button>
          <ul>
            {matches.map((g) => (
              <li key={g.id}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraft({
                      ...empty,
                      guardian_id: g.id,
                      guardian_name: g.name,
                      guardian_mobile: g.phone,
                      guardian_email: g.email ?? "",
                      guardian_language: g.language,
                    });
                    setVersion(g.contact_version);
                  }}
                >
                  {g.name} · {g.phone} — use reviewed identity
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            onClick={() => {
              setDraft({ ...empty });
              setVersion(null);
            }}
          >
            Use a distinct new guardian
          </Button>
          {draft.guardian_id && (
            <p>
              Reusing selected guardian identity. Contact changes use Edit Guardian after linking.
            </p>
          )}
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void work(async () => {
                await academicRpc("link_student_guardian", {
                  p_student: props.studentId,
                  p_guardian: draft,
                  p_relationship: relation,
                  p_expected_contact_version: version,
                  p_reason: props.reason,
                });
                setDraft({ ...empty });
                setVersion(null);
                setMatches([]);
              });
            }}
          >
            {(
              [
                ["guardian_name", "Guardian full name"],
                ["guardian_mobile", "Guardian mobile (+country code)"],
                ["guardian_email", "Guardian email"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  aria-label={label}
                  value={draft[key]}
                  required={key !== "guardian_email"}
                  type={key === "guardian_email" ? "email" : "text"}
                  maxLength={key === "guardian_name" ? 120 : key === "guardian_mobile" ? 80 : 200}
                  readOnly={!!draft.guardian_id}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              </label>
            ))}
            <label>
              Preferred language
              <select
                aria-label="Guardian language"
                className={selectStyle}
                disabled={!!draft.guardian_id}
                value={draft.guardian_language}
                onChange={(e) => setDraft((d) => ({ ...d, guardian_language: e.target.value }))}
              >
                {languages.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Relationship
              <select
                aria-label="Guardian relationship"
                className={selectStyle}
                value={relation.relationship}
                onChange={(e) => setRelation((r) => ({ ...r, relationship: e.target.value }))}
              >
                {relationships.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effective from
              <Input
                aria-label="Guardian effective from"
                type="date"
                required
                value={relation.effective_from}
                onChange={(e) => setRelation((r) => ({ ...r, effective_from: e.target.value }))}
              />
            </label>
            <label>
              Effective until (optional)
              <Input
                aria-label="Guardian effective until"
                type="date"
                value={relation.effective_until}
                onChange={(e) => setRelation((r) => ({ ...r, effective_until: e.target.value }))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={relation.is_primary}
                onChange={(e) => setRelation((r) => ({ ...r, is_primary: e.target.checked }))}
              />{" "}
              Primary notification recipient (requires no existing overlapping primary)
            </label>
            <label>
              <input
                type="checkbox"
                checked={relation.receives_notifications}
                onChange={(e) =>
                  setRelation((r) => ({ ...r, receives_notifications: e.target.checked }))
                }
              />{" "}
              Receives notifications preference; does not grant consent
            </label>
            {!draft.guardian_id && (
              <label>
                <input
                  type="checkbox"
                  checked={draft.guardian_distinct_acknowledged}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, guardian_distinct_acknowledged: e.target.checked }))
                  }
                />{" "}
                I reviewed any shared name/mobile and confirmed this is a distinct person.
              </label>
            )}
            <Button disabled={disabled}>Confirm guardian link</Button>
          </form>
        </div>
      </details>
    </section>
  );
}
const languages = [
  ["en", "English"],
  ["hi", "Hindi"],
  ["te", "Telugu"],
  ["ta", "Tamil"],
  ["kn", "Kannada"],
] as const;
const relationships = [
  ["mother", "Mother"],
  ["father", "Father"],
  ["guardian", "Legal guardian"],
  ["other", "Other authorized guardian"],
] as const;
function GuardianCard({
  link: r,
  studentId,
  disabled,
  reason,
  work,
}: {
  link: Link;
  studentId: string;
  disabled: boolean;
  reason: string;
  work: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [details, setDetails] = useState({
    name: r.name,
    phone: r.phone,
    email: r.email ?? "",
    language: r.language,
    active: r.guardian_active,
    contact_metadata: r.contact_metadata,
    distinct_acknowledged: false,
  });
  const [until, setUntil] = useState(""),
    [reference, setReference] = useState(""),
    [consent, setConsent] = useState("false");
  const change = (action: string, extra: Record<string, unknown> = {}) =>
    work(() =>
      academicRpc("change_guardian_relationship", {
        p_relationship: r.id,
        p_revision: r.revision,
        p_changes: { action, ...extra },
        p_reason: reason,
      }),
    );
  return (
    <article className="space-y-3 rounded border p-3">
      <h4 className="font-semibold">
        {r.name} · {relationships.find(([v]) => v === r.relationship)?.[1] ?? r.relationship} ·{" "}
        {r.is_primary ? "Primary" : "Secondary"}
      </h4>
      <p>
        {r.phone} · {r.email ?? "Email not recorded"} ·{" "}
        {r.guardian_active ? "Active contact" : "Inactive contact"}
      </p>
      <p>
        {r.effective_from} — {r.effective_until ?? "Open ended"} · {r.status}
        {r.end_reason ? ` · ${r.end_reason}` : ""}
      </p>
      <p>
        Receives notifications: {r.receives_notifications ? "Yes" : "No"}. Current
        student/relationship eligibility: {r.preference_eligible ? "Eligible" : "Ineligible"}.
        Communication consent: {r.communication_consent ? "Recorded" : "Not recorded"}.
      </p>
      <p className="text-sm">
        Current-project devices with current enrollment consent: {r.registered_devices}. Device
        registration alone does not make this student relationship eligible.
      </p>
      {r.status === "active" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={disabled || r.is_primary}
              onClick={() => void change("primary")}
            >
              Change Primary
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void change("preference", {
                  receives_notifications: !r.receives_notifications,
                  preferred_channel: r.preferred_channel ?? "",
                })
              }
            >
              {r.receives_notifications ? "Stop Notifications" : "Allow notification preference"}
            </Button>
          </div>
          <label>
            Preferred channel (optional)
            <select
              aria-label={`Preferred channel for ${r.name}`}
              className={selectStyle}
              value={r.preferred_channel ?? ""}
              disabled={disabled}
              onChange={(e) =>
                void change("preference", {
                  receives_notifications: r.receives_notifications,
                  preferred_channel: e.target.value,
                })
              }
            >
              <option value="">No channel preference</option>
              {["sms", "push", "voice", "whatsapp"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void change("end", { effective_until: until });
            }}
          >
            <label>
              Actual relationship cutoff
              <Input
                aria-label={`Relationship cutoff for ${r.name}`}
                required
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
            <Button variant="outline" disabled={disabled}>
              End Relationship
            </Button>
          </form>
        </div>
      )}
      {r.can_edit_identity ? (
        <>
          <details>
            <summary>Edit Guardian</summary>
            <p>
              Contact changes affect every linked child. A changed mobile or active state revokes
              old channel registrations and requires fresh communication consent and enrollment.
            </p>
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void work(() =>
                  academicRpc("update_guardian_contact", {
                    p_student: studentId,
                    p_guardian: r.guardian_id,
                    p_details: details,
                    p_version: r.contact_version,
                    p_reason: reason,
                  }),
                );
              }}
            >
              {(["name", "phone", "email"] as const).map((k) => (
                <label key={k}>
                  {k}
                  <Input
                    aria-label={`Edit guardian ${k}`}
                    required={k !== "email"}
                    value={details[k]}
                    maxLength={k === "name" ? 120 : k === "phone" ? 80 : 200}
                    onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
                  />
                </label>
              ))}
              <label>
                Language
                <select
                  className={selectStyle}
                  value={details.language}
                  onChange={(e) => setDetails((d) => ({ ...d, language: e.target.value }))}
                >
                  {languages.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Contact note
                <Input
                  aria-label="Guardian contact note"
                  maxLength={1000}
                  value={String(details.contact_metadata["note"] ?? "")}
                  onChange={(e) =>
                    setDetails((d) => ({
                      ...d,
                      contact_metadata: { ...d.contact_metadata, note: e.target.value },
                    }))
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={details.active}
                  onChange={(e) => setDetails((d) => ({ ...d, active: e.target.checked }))}
                />{" "}
                Active contact
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={details.distinct_acknowledged}
                  onChange={(e) =>
                    setDetails((d) => ({ ...d, distinct_acknowledged: e.target.checked }))
                  }
                />{" "}
                I reviewed any duplicate mobile as a distinct person.
              </label>
              <Button disabled={disabled}>Save guardian contact</Button>
            </form>
          </details>
          <details>
            <summary>Record separate communication consent / withdrawal</summary>
            <p>
              Record an actual affirmative consent or withdrawal and its private evidence reference.
              This does not grant browser permission or enrollment notice consent.
            </p>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void work(() =>
                  academicRpc("record_guardian_communication_consent", {
                    p_student: studentId,
                    p_guardian: r.guardian_id,
                    p_version: r.contact_version,
                    p_accepted: consent === "true",
                    p_reference: reference,
                    p_reason: reason,
                  }),
                );
              }}
            >
              <select
                aria-label="Recorded guardian communication consent"
                className={selectStyle}
                value={consent}
                onChange={(e) => setConsent(e.target.value)}
              >
                <option value="false">Withdraw / declined communication consent</option>
                <option value="true">Affirmative consent independently obtained</option>
              </select>
              <Input
                aria-label="Communication consent evidence reference"
                required
                minLength={10}
                maxLength={300}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Private record reference for actual consent/withdrawal"
              />
              <Button disabled={disabled}>Record communication consent decision</Button>
            </form>
          </details>
        </>
      ) : (
        <p>
          Shared contact edits require authority over all linked students. Ask an institution
          administrator to review the contact.
        </p>
      )}
    </article>
  );
}
