import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LogIn } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  head: () => ({
    meta: [{ title: "Login — AttendAI" }],
  }),
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
      await router.navigate({ to: staff ? "/" : "/institution-verification" });
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
    <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-muted/20">
      <Card className="w-full max-w-md shadow-lg border-primary/20">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <LogIn className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-display">AttendAI</CardTitle>
          <CardDescription>Sign in to your staff account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
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
                placeholder="name@attendai.edu"
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
            <Button type="submit" className="w-full mt-4" disabled={!!isLoggingIn}>
              {isLoggingIn === "password" ? "Signing in..." : "Sign in"}
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
              <p className="text-center text-sm text-muted-foreground">{resetMessage}</p>
            )}
          </form>
          <div className="border-t pt-4 text-center text-sm text-muted-foreground">
            <p>New institution?</p>
            <Link
              to="/create-account"
              className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an administrator account
            </Link>
            <p className="mt-4 flex justify-center gap-4 text-xs">
              <Link to="/privacy" className="hover:underline">
                Privacy Policy
              </Link>
              <Link to="/terms" className="hover:underline">
                Terms & Conditions
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
