import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { emptyVerificationDetails, type VerificationDetails } from "@/lib/institution-verification";
import { setupProfile, setupRpc } from "@/lib/services/staff-setup";

export function StaffAuthorityRequest() {
  const { user } = useAuth();
  const [details, setDetails] = useState<VerificationDetails>({ ...emptyVerificationDetails });
  const [purpose, setPurpose] = useState("ownership_recovery");
  const [capability, setCapability] = useState("institution_owner");
  const [reason, setReason] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (user?.institutionId)
      void setupProfile(user.institutionId)
        .then((p) => {
          if (live) {
            setDetails((d) => ({
              ...d,
              institution_name: p.name,
              institution_type: p.institution_type,
              state: p.state,
              city: p.city ?? "",
              applicant_name: user.name,
            }));
            setReady(true);
          }
        })
        .catch(() => {
          if (live) setError("Verified institution details could not be loaded.");
        });
    else setReady(true);
    return () => {
      live = false;
    };
  }, [user?.institutionId, user?.name]);
  const fields: [keyof VerificationDetails, string, string?][] = [
    ["institution_name", "Verified institution"],
    ["state", "Verified state"],
    ["institution_type", "Verified institution type"],
    ["applicant_name", "Successor full name"],
    ["applicant_phone", "Successor phone"],
    ["official_email", "Institutional email (optional)", "email"],
    ["designation", "New leadership designation"],
    ["signatory_name", "Authorization signatory name"],
    ["signatory_designation", "Authorization signatory designation"],
    ["authorization_date", "Authorization date", "date"],
    ["authority_statement", "Successor authority statement"],
  ];
  return (
    <details className="rounded border p-4 space-y-3">
      <summary className="font-semibold">
        Request ownership recovery or leadership authority review
      </summary>
      <p>
        Use your own verified account as the proposed successor. Existing active staff can request
        review directly. An external successor must enter the exact registered institution name,
        state and type. Provide fresh authorization, recognition evidence and a challenge photo
        after saving. An independent platform reviewer must verify authority with an official
        institution contact.
      </p>
      <p>
        Requests grant no access. Existing institutional verification and the previous
        representative's records remain intact.
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void setupRpc("start_staff_authority_review", {
            p_institution: user?.institutionId ?? null,
            p_purpose: purpose,
            p_capability: purpose === "ownership_recovery" ? "institution_owner" : capability,
            p_details: details,
            p_reason: reason,
          })
            .then(() => window.location.assign("/institution-verification"))
            .catch((e) =>
              setError(e instanceof Error ? e.message : "Authority review request failed."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <fieldset disabled={!ready || busy} className="space-y-3">
          <label>
            Review purpose
            <select
              className="block rounded border bg-background p-2"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            >
              <option value="ownership_recovery">Emergency ownership recovery</option>
              <option value="leadership_replacement">
                Principal / registrar / leadership replacement
              </option>
            </select>
          </label>
          {purpose === "leadership_replacement" && (
            <label>
              Requested capability
              <select
                className="block rounded border bg-background p-2"
                value={capability}
                onChange={(e) => setCapability(e.target.value)}
              >
                <option value="institution_owner">Institution Owner</option>
                <option value="institution_admin">Institution Admin</option>
              </select>
            </label>
          )}
          {fields.map(([key, label, type]) => (
            <label className="block" key={key}>
              {label}
              <Input
                aria-label={label}
                type={type ?? "text"}
                readOnly={
                  !!user?.institutionId &&
                  ["institution_name", "state", "institution_type"].includes(key)
                }
                required={key !== "official_email"}
                maxLength={key === "authority_statement" ? 2000 : 200}
                value={details[key]}
                onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))}
              />
            </label>
          ))}
          <label>
            Leadership role
            <select
              className="block rounded border bg-background p-2"
              value={details.leadership_role}
              onChange={(e) =>
                setDetails((d) => ({
                  ...d,
                  leadership_role: e.target.value as VerificationDetails["leadership_role"],
                }))
              }
            >
              {["principal", "director", "registrar", "secretary", "authorized_representative"].map(
                (r) => (
                  <option key={r} value={r}>
                    {r.replaceAll("_", " ")}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Why recovery or replacement is required
            <Input
              required
              minLength={20}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={!ready || busy}>
            Save authority review draft
          </Button>
        </fieldset>
      </form>
    </details>
  );
}
