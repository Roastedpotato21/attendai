import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { currentPolicies, acceptPolicies } from "@/lib/policy-acceptance";
import { Button } from "@/components/ui/button";

export function VerificationPolicyGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  useEffect(() => {
    let active = true;
    void currentPolicies()
      .then((p) => {
        if (active) setAccepted(p.every((v) => v.accepted));
      })
      .catch(() => {
        if (active) {
          setAccepted(false);
          setError("Policy status could not be loaded. Please reload to try again.");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  if (accepted === null) return <p>Checking required policies…</p>;
  if (accepted) return <>{children}</>;
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Accept the required policies to continue</h2>
      <label className="flex gap-2">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span>
          I agree to the{" "}
          <Link to="/terms" target="_blank" className="underline">
            Terms & Conditions
          </Link>
          .
        </span>
      </label>
      <label className="flex gap-2">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        <span>
          I acknowledge the{" "}
          <Link to="/privacy" target="_blank" className="underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={!terms || !privacy}
        onClick={() => {
          void acceptPolicies("signup")
            .then(() => {
              setError("");
              setAccepted(true);
            })
            .catch(() => setError("Your policy acceptance could not be saved. Please try again."));
        }}
      >
        Accept and continue
      </Button>
    </div>
  );
}
