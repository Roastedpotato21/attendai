import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Building2 } from "lucide-react";

import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasDatabaseConnection, supabase } from "@/lib/db/connection";
import { normalizeAuthEmail, signUpErrorMessage } from "@/lib/auth-errors";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeInstitutionCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const Route = createFileRoute("/create-account")({
  head: () => ({ meta: [{ title: "Create institution account — AttendAI" }] }),
  component: CreateAccountPage,
});

function CreateAccountPage() {
  const router = useRouter();
  const { user, completeNewInstitutionOnboarding } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [institutionCode, setInstitutionCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [awaitingVerification, setAwaitingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completionStarted = useRef(false);

  const finishOnboarding = useCallback(async () => {
    setIsCompleting(true);
    setError(null);
    try {
      await completeNewInstitutionOnboarding();
      await router.navigate({ to: "/", replace: true });
    } catch (completionError) {
      setError(
        completionError instanceof Error
          ? completionError.message
          : "We could not complete institution setup. Please try again.",
      );
    } finally {
      setIsCompleting(false);
    }
  }, [completeNewInstitutionOnboarding, router]);

  useEffect(() => {
    if (user || completionStarted.current || !hasDatabaseConnection() || !supabase) return;

    const authClient = supabase;
    let active = true;

    const tryComplete = async () => {
      const {
        data: { user: verifiedUser },
      } = await authClient.auth.getUser();
      if (!active || !verifiedUser?.email_confirmed_at) return;
      if (completionStarted.current) return;
      completionStarted.current = true;
      setAwaitingVerification(true);
      await finishOnboarding();
    };

    // Attempt immediately (covers the case where the session is already
    // established, e.g. the user refreshes the page after verification).
    void tryComplete();

    // Also listen for auth state changes — the Supabase client's
    // detectSessionInUrl processing fires SIGNED_IN asynchronously after the
    // URL code/token has been exchanged. Without this listener the useEffect
    // above fires before the session is ready and silently does nothing.
    const { data: sub } = authClient.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        void tryComplete();
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [finishOnboarding, user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedName = name.trim();
    const normalizedEmail = normalizeAuthEmail(email);
    const normalizedInstitutionName = institutionName.trim();
    const normalizedInstitutionCode = normalizeInstitutionCode(institutionCode);

    if (normalizedName.length < 2 || normalizedName.length > 120) {
      setError("Enter your full name (2–120 characters).");
      return;
    }
    if (!emailPattern.test(normalizedEmail)) {
      setError("Enter a valid work email address.");
      return;
    }
    if (normalizedInstitutionName.length < 2 || normalizedInstitutionName.length > 120) {
      setError("Enter an institution name (2–120 characters).");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalizedInstitutionCode)) {
      setError(
        "Use a 2–63 character institution code with lowercase letters, numbers, and hyphens.",
      );
      return;
    }
    if (password.length < 12) {
      setError("Use a password of at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!hasDatabaseConnection() || !supabase) {
      setError("Institution account creation needs a connected Supabase environment.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: new URL("/create-account", window.location.origin).toString(),
          data: {
            name: normalizedName,
            onboarding_intent: "new_institution_admin",
            onboarding_institution_name: normalizedInstitutionName,
            onboarding_institution_code: normalizedInstitutionCode,
          },
        },
      });
      setPassword("");
      setConfirmPassword("");

      // Supabase intentionally returns an empty identities list for an
      // already-registered email. Keep the response non-enumerating.
      if (signUpError) {
        setError(signUpErrorMessage(signUpError));
        return;
      }
      if (!data.user) {
        setError(
          "We could not verify that your authentication account was created. Please try again.",
        );
        return;
      }
      if (data.user.identities?.length === 0) {
        setError(
          "An account may already exist for this email. Try signing in or resetting your password.",
        );
        return;
      }

      setAwaitingVerification(true);
      if (data.session && data.user.email_confirmed_at) {
        completionStarted.current = true;
        await finishOnboarding();
      }
    } catch {
      setPassword("");
      setConfirmPassword("");
      setError("We could not create your institution account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (user) {
    return (
      <AccountCard
        title="You already have staff access"
        description="Use your existing administrator account to invite faculty and staff."
      >
        <Button asChild className="w-full">
          <Link to="/">Go to dashboard</Link>
        </Button>
      </AccountCard>
    );
  }

  if (awaitingVerification) {
    const hasProvisioningError = !!error && !isCompleting;

    return (
      <AccountCard
        title={
          isCompleting
            ? "Creating your institution…"
            : hasProvisioningError
              ? "Institution setup incomplete"
              : "Check your email"
        }
        description={
          isCompleting
            ? "We are securely creating your institution and administrator membership."
            : hasProvisioningError
              ? "Your email is verified, but we could not finish setting up your institution."
              : "Verify your work email using the link we sent. Institution setup will complete after verification."
        }
      >
        {error && <ErrorMessage message={error} />}
        {hasProvisioningError && (
          <Button
            className="w-full"
            onClick={() => {
              completionStarted.current = false;
              void finishOnboarding();
            }}
          >
            Retry institution setup
          </Button>
        )}
        {!isCompleting && !hasProvisioningError && (
          <p className="text-center text-sm text-muted-foreground">
            Already verified? Reopen the verification link, or return to the login page.
          </p>
        )}
        <Button asChild className="w-full" variant="outline">
          <Link to="/login" search={{ redirect: undefined }}>
            Back to sign in
          </Link>
        </Button>
      </AccountCard>
    );
  }

  return (
    <AccountCard
      title="Create your AttendAI institution account"
      description="This creates one new institution and its first administrator. Faculty and staff are invited later."
    >
      <form className="space-y-4" onSubmit={submit}>
        {error && <ErrorMessage message={error} />}
        <fieldset className="space-y-4" disabled={isSubmitting}>
          <div className="space-y-2">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              autoComplete="name"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="work-email">Work email</Label>
            <Input
              id="work-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="institution-name">Institution name</Label>
            <Input
              id="institution-name"
              autoComplete="organization"
              maxLength={120}
              value={institutionName}
              onChange={(event) => setInstitutionName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="institution-code">Institution code</Label>
            <Input
              id="institution-code"
              autoComplete="off"
              maxLength={63}
              placeholder="northstar-college"
              value={institutionCode}
              onChange={(event) => setInstitutionCode(event.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="new-password">Password</Label>
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
        </fieldset>
        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create institution account"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/login"
          search={{ redirect: undefined }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AccountCard>
  );
}

function AccountCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md border-primary/20 shadow-lg">
        <CardHeader className="pb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-display">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{message}</div>;
}
