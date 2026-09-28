import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasDatabaseConnection, supabase } from "@/lib/db/connection";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Set your password — AttendAI" }] }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const router = useRouter();
  const { completeInvitation } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isValidInvite, setIsValidInvite] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const validateInvite = async () => {
      if (!hasDatabaseConnection() || !supabase) {
        if (active) setIsValidInvite(false);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (active) setIsValidInvite(Boolean(user));
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
    setIsSubmitting(true);
    try {
      await completeInvitation(password);
      await router.navigate({ to: "/", replace: true });
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="pb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-display">Set your AttendAI password</CardTitle>
          <CardDescription>
            Your email has been verified. Set a password to finish joining your institution.
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
              <Button className="mt-2 w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Finishing setup…" : "Finish setup"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
