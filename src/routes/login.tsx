import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { LogIn } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth/auth-context";
import { hasDatabaseConnection } from "@/lib/db/connection";

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
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [isLoggingIn, setIsLoggingIn] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { redirect } = Route.useSearch();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn("password");
    setError(null);

    try {
      const user = await loginWithPassword(email, password);

      // Determine where to send the user after login
      const safeRedirect = sanitizeRedirect(redirect);
      if (safeRedirect) {
        await router.navigate({ href: safeRedirect });
      } else if (user?.role === "student") {
        await router.navigate({ to: "/student-dashboard" });
      } else {
        await router.navigate({ to: "/" });
      }
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : "Failed to log in.");
    } finally {
      setIsLoggingIn(null);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4 bg-muted/20">
      <Card className="w-full max-w-md shadow-lg border-primary/20">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <LogIn className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl font-display">Welcome to AttendAI</CardTitle>
          <CardDescription>
            {hasDatabaseConnection()
              ? "Sign in to your account"
              : "Sign in or select a mock account"}
          </CardDescription>
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
                type="email"
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full mt-4" disabled={!!isLoggingIn}>
              {isLoggingIn === "password" ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
