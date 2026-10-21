import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { AuthPage, authPageHead } from "@/components/auth/auth-page";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth/auth-context";

/**
 * Sanitize a post-login redirect to prevent open-redirect attacks.
 * Only allows relative paths on the same origin — rejects protocols,
 * double-slash protocol-relative URLs, and external hostnames.
 */
function sanitizeRedirect(raw: string | undefined): string | null {
  if (!raw) return null;
  // Must start with exactly one "/" and not be protocol-relative ("//")
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  try {
    // Parse against a dummy origin to validate the path is well-formed
    const url = new URL(raw, "http://localhost");
    // Reject if the hostname was overridden (e.g., "/\\evil.com" edge-case)
    if (url.hostname !== "localhost") return null;
    // Return only the path+search+hash (strips any injected origin)
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      redirect: search["redirect"] as string | undefined,
    };
  },
  head: () => authPageHead("Sign in", "Sign in to your verified AttendAI institution workspace."),
  component: LoginPage,
});
function LoginPage() {
  const { loginWithPassword, sendPasswordReset } = useAuth();
  const router = useRouter();
  const [isLoggingIn, setIsLoggingIn] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const { redirect } = Route.useSearch();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn("password");
    setError(null);

    try {
      const staff = await loginWithPassword(email, password);

      // Validate but intentionally ignore deep links: staff always enter via the dashboard.
      void sanitizeRedirect(redirect);
      await router.navigate({ to: staff ? "/dashboard" : "/institution-verification" });
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : "Failed to log in.");
    } finally {
      setIsLoggingIn(null);
    }
  };

  const requestPasswordReset = async () => {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setError(null);
    setResetMessage(null);
    try {
      await sendPasswordReset(email);
      setResetMessage("If this email belongs to a staff account, a reset link has been sent.");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Password recovery is temporarily unavailable.",
      );
    }
  };

  return (
    <AuthPage>
      <Card className="aw-auth-card">
        <CardHeader>
          <p className="aw-kicker">WELCOME BACK</p>
          <h1 id="auth-title">Your day starts here.</h1>
          <CardDescription className="aw-auth-description">
            Sign in to your institution account to continue your work or verification.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            {error && (
              <div role="alert" className="aw-auth-error">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="aw-auth-submit" disabled={!!isLoggingIn}>
              {isLoggingIn === "password" ? "Signing in..." : "Sign in"}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              onClick={() => void requestPasswordReset()}
            >
              Forgot password?
            </Button>
            {resetMessage && (
              <p role="status" className="aw-auth-reset">
                {resetMessage}
              </p>
            )}
          </form>
          <div className="aw-auth-switch">
            <p>New institution?</p>
            <Link
              to="/create-account"
              className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an administrator account
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthPage>
  );
}
