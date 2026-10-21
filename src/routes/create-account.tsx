import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-context";
import { InstitutionSearch } from "@/components/auth/institution-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { supabase } from "@/lib/db/connection";
import { normalizeAuthEmail, signUpErrorMessage } from "@/lib/auth-errors";
import type { RegistryMatch } from "@/lib/institution-verification";
import { AuthPage, authPageHead } from "@/components/auth/auth-page";

export const Route = createFileRoute("/create-account")({
  head: () =>
    authPageHead(
      "Register an institution",
      "Create an applicant account and begin independent institution verification.",
    ),
  component: CreateAccountPage,
});
function CreateAccountPage() {
  const router = useRouter();
  const { user, verificationAccess } = useAuth();
  const [selected, setSelected] = useState<RegistryMatch | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active && data.user?.email_confirmed_at && !user)
        void router.navigate({ to: "/institution-verification", replace: true });
    });
    return () => {
      active = false;
    };
  }, [router, user]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 12 || password !== confirm) {
      setError("Use at least 12 characters and enter the same password twice.");
      return;
    }
    if (!terms || !privacy || selected === undefined) {
      setError("Choose an institution or manual review and accept the policies.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: normalizeAuthEmail(email),
        password,
        options: {
          emailRedirectTo: new URL("/institution-verification", window.location.origin).href,
          data: {
            name: name.trim(),
            onboarding_intent: "institution_verification",
            registry_id_hint: selected?.id ?? null,
            institution_name_hint: selected?.canonical_name ?? query.trim(),
            terms_accepted: true,
            privacy_acknowledged: true,
          },
        },
      });
      setPassword("");
      setConfirm("");
      if (signupError) {
        setError(signUpErrorMessage(signupError));
        return;
      }
      if (!data.user || data.user.identities?.length === 0) {
        setSent(true);
        return;
      }
      if (data.session && data.user.email_confirmed_at)
        await router.navigate({ to: "/institution-verification" });
      else setSent(true);
    } catch {
      setError("Account identity could not be created. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthPage signup>
      <Card className="aw-auth-card">
        <CardHeader>
          <p className="aw-kicker">GET STARTED</p>
          <h1 id="auth-title">Register your institution</h1>
          <CardDescription className="aw-auth-description">
            Institution existence and your authority to represent it are verified separately.
            Submitting an application does not grant institution access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {user ? (
            <>
              <p>
                You already have staff access. Use the authorized administrator recovery process for
                an existing institution.
              </p>
              <Button asChild>
                <Link to="/dashboard">Go to dashboard</Link>
              </Button>
            </>
          ) : verificationAccess ? (
            <Button asChild>
              <Link to="/institution-verification">Continue verification</Link>
            </Button>
          ) : sent ? (
            <div role="status" className="space-y-3">
              <h2 className="font-semibold">Check your email</h2>
              <p>
                Verify your account identity using the email link. If an account already exists,
                sign in or reset its password. Your institution will remain pending until
                independently approved.
              </p>
              <Button asChild variant="outline">
                <Link to="/login" search={{ redirect: undefined }}>
                  Sign in
                </Link>
              </Button>
            </div>
          ) : selected === undefined ? (
            <>
              <h2 className="font-semibold">Step 1 — Find institution</h2>
              <InstitutionSearch
                onSelect={(match, text) => {
                  setSelected(match);
                  setQuery(text);
                }}
              />
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="rounded-lg border p-3">
                <strong>
                  {selected?.canonical_name ?? (query || "Manual institution review")}
                </strong>
                <p className="text-sm">
                  {selected
                    ? selected.state + " · " + selected.institution_type
                    : "Institution not listed: manual review is available."}
                </p>
                <Button type="button" variant="link" onClick={() => setSelected(undefined)}>
                  Change institution selection
                </Button>
              </div>
              <h2 className="font-semibold">Verify your account identity to continue</h2>
              <p className="text-sm text-muted-foreground">
                Email verification creates an applicant identity. It does not make you an
                institution administrator.
              </p>
              <fieldset disabled={busy} className="space-y-4">
                <div>
                  <Label htmlFor="full-name">Your full name</Label>
                  <Input
                    id="full-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                    autoComplete="name"
                  />
                </div>
                <div>
                  <Label htmlFor="work-email">Your email</Label>
                  <Input
                    id="work-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div>
                  <Label htmlFor="new-password">Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    required
                    checked={terms}
                    onChange={(e) => setTerms(e.target.checked)}
                  />
                  <span>
                    I agree to the{" "}
                    <Link to="/terms" target="_blank" className="underline">
                      Terms & Conditions
                    </Link>
                    .
                  </span>
                </label>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    required
                    checked={privacy}
                    onChange={(e) => setPrivacy(e.target.checked)}
                  />
                  <span>
                    I acknowledge the{" "}
                    <Link to="/privacy" target="_blank" className="underline">
                      Privacy Policy
                    </Link>
                    .
                  </span>
                </label>
              </fieldset>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="aw-auth-submit" disabled={busy}>
                {busy ? "Creating account identity…" : "Create applicant account"}
              </Button>
            </form>
          )}
          <p className="aw-auth-switch">
            Already registered?{" "}
            <Link to="/login" search={{ redirect: undefined }} className="underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthPage>
  );
}
