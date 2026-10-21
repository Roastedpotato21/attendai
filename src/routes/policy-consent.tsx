import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptPolicies, currentPolicies, type CurrentPolicy } from "@/lib/policy-acceptance";

export const Route = createFileRoute("/policy-consent")({ component: PolicyConsent });

function PolicyConsent() {
  const { user, logout } = useAuth();
  const [records, setRecords] = useState<CurrentPolicy[] | null>(null);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    void currentPolicies()
      .then(setRecords)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Policy check failed."),
      );
  }, [user]);
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Sign in to review policies</CardTitle>
          </CardHeader>
          <CardContent>
            <Link to="/login" search={{ redirect: undefined }} className="text-primary underline">
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }
  const submit = async () => {
    if (!terms || !privacy) return;
    setBusy(true);
    setError("");
    try {
      await acceptPolicies("access_gate");
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save acceptance.");
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Review AttendAI policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Review the current policies to continue using your staff account. Guardian communication
            preferences remain separate.
          </p>
          {records && (
            <p className="text-sm text-muted-foreground">
              Terms version {records.find((v) => v.type === "terms")?.version}; Privacy version{" "}
              {records.find((v) => v.type === "privacy")?.version}
            </p>
          )}
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
            />
            <span>
              I have read and agree to the{" "}
              <Link className="text-primary underline" to="/terms" target="_blank">
                Terms & Conditions
              </Link>
              .
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
            <span>
              I acknowledge the{" "}
              <Link className="text-primary underline" to="/privacy" target="_blank">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            disabled={!records || !terms || !privacy || busy}
            onClick={() => void submit()}
          >
            Accept and continue
          </Button>
          <Button className="w-full" variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
