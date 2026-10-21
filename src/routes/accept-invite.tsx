import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthPage, authPageHead } from "@/components/auth/auth-page";

import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasDatabaseConnection, supabase } from "@/lib/db/connection";
import { acceptPolicies } from "@/lib/policy-acceptance";

export const Route = createFileRoute("/accept-invite")({
  head: () => {
    const head = authPageHead("Set your password", "Complete your verified AttendAI invitation.");
    return { ...head, meta: [...head.meta, { name: "referrer", content: "no-referrer" }] };
  },
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const router = useRouter();
  const { completeInvitation } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [isValidInvite, setIsValidInvite] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffInvitation, setStaffInvitation] = useState<string | undefined>();

  useEffect(() => {
    const callback = new URL(window.location.href);
    const invitation = callback.searchParams.get("staff_invitation");
    if (invitation && /^[0-9a-f]{64}$/.test(invitation)) {
      window.sessionStorage.setItem("attendai:staff-invitation", invitation);
      callback.searchParams.delete("staff_invitation");
      window.history.replaceState(null, "", callback.pathname + callback.search + callback.hash);
    }
    setStaffInvitation(window.sessionStorage.getItem("attendai:staff-invitation") ?? undefined);
    let active = true;
    const validateInvite = async () => {
      if (!hasDatabaseConnection() || !supabase) {
        if (active) setIsValidInvite(false);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (active) setIsValidInvite(Boolean(user?.email_confirmed_at));
    };
    void validateInvite();
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Use a password of at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!termsAccepted || !privacyAcknowledged) {
      setError("Accept the Terms & Conditions and acknowledge the Privacy Policy to finish setup.");
      return;
    }
    setIsSubmitting(true);
    try {
      await acceptPolicies("signup");
      const staff = await completeInvitation(password, staffInvitation);
      window.sessionStorage.removeItem("attendai:staff-invitation");
      await router.navigate({
        to: staff ? "/dashboard" : "/institution-verification",
        replace: true,
      });
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthPage>
      <Card className="aw-auth-card">
        <CardHeader>
          <p className="aw-kicker">YOUR INVITATION</p>
          <h1 id="auth-title">Set your AttendAI password</h1>
          <CardDescription className="aw-auth-description">
            Use your verified invitation link, then set a password to finish joining your
            institution.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isValidInvite === null ? (
            <p className="text-center text-sm text-muted-foreground">Verifying invitation…</p>
          ) : !isValidInvite ? (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              This invitation link is invalid or has expired. Ask your administrator to send a new
              one.
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              {error && (
                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-3 border-t pt-4 text-sm">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                    required
                  />
                  <span>
                    I have read and agree to the{" "}
                    <Link to="/terms" target="_blank" className="text-primary underline">
                      Terms & Conditions
                    </Link>
                    .
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={privacyAcknowledged}
                    onChange={(event) => setPrivacyAcknowledged(event.target.checked)}
                    required
                  />
                  <span>
                    I acknowledge the{" "}
                    <Link to="/privacy" target="_blank" className="text-primary underline">
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>
              </div>
              <Button className="mt-2 w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Finishing setup…" : "Finish setup"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthPage>
  );
}
