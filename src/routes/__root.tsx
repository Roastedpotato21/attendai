import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/components/auth/auth-context";
import type { AuthUser } from "@/lib/types";
import { getPublicRoutes, isRouteAllowed } from "@/lib/route-auth";
import { currentPolicies } from "@/lib/policy-acceptance";
import { hasDatabaseConnection } from "@/lib/db/connection";
import { staffRouteAllowed } from "@/lib/staff-setup";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const configurationError =
    error instanceof Error && /VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY/.test(error.message);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {configurationError ? "Supabase configuration is incomplete" : "This page didn't load"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {configurationError
            ? "Set the browser-safe VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY values, then reload."
            : "Something went wrong on our end. You can try refreshing or head back home."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export interface RouterContext {
  queryClient: QueryClient;
  auth: { user: AuthUser | null };
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AttendAI — AI Attendance & Parent Communication" },
      {
        name: "description",
        content:
          "AttendAI automates attendance tracking, multilingual AI voice calls and parent messaging for schools and colleges.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthWrapper />
      </AuthProvider>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

const PUBLIC_ROUTES = getPublicRoutes();

function AuthWrapper() {
  const { user, isLoading, verificationAccess } = useAuth();
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isPublicContent = ["/privacy", "/terms", "/guardian-notifications"].includes(pathname);
  const [policyState, setPolicyState] = useState<"checking" | "accepted" | "required">("checking");

  useEffect(() => {
    if (!user || !hasDatabaseConnection()) {
      setPolicyState("accepted");
      return;
    }
    let active = true;
    setPolicyState("checking");
    void currentPolicies()
      .then((records) => {
        if (active)
          setPolicyState(records.every((record) => record.accepted) ? "accepted" : "required");
      })
      .catch(() => {
        if (active) setPolicyState("required");
      });
    return () => {
      active = false;
    };
  }, [user]);

  // Keep router context in sync with auth state
  useEffect(() => {
    router.update({ context: { ...router.options.context, auth: { user } } });
  }, [user, router]);

  // Centralized route guard logic using the shared route-auth config
  useEffect(() => {
    if (isLoading || isPublicContent) return;
    if (
      !user &&
      verificationAccess &&
      ![
        "/institution-verification",
        "/institution-review",
        "/create-account",
        "/accept-invite",
        "/policy-consent",
      ].includes(pathname)
    ) {
      void router.navigate({ to: "/institution-verification", replace: true });
      return;
    }

    if (
      user &&
      policyState === "required" &&
      !["/privacy", "/terms", "/policy-consent", "/create-account"].includes(pathname)
    ) {
      void router.navigate({ to: "/policy-consent", replace: true });
      return;
    }

    if (!user && !isPublicRoute) {
      // Unauthenticated → redirect to login
      void router.navigate({
        to: "/login",
        search: { redirect: pathname },
        replace: true,
      });
    } else if (
      user &&
      !isPublicRoute &&
      !staffRouteAllowed(
        pathname,
        !!user.staffModel,
        !!user.canManageSetup,
        !!user.legacyClassAccess,
      )
    ) {
      void router.navigate({ to: "/", replace: true });
    } else if (user && pathname === "/login") {
      // Authenticated but on login page → redirect to home
      void router.navigate({ to: "/", replace: true });
    } else if (user && !isRouteAllowed(pathname, user.role)) {
      // Role not allowed for this route → redirect to home
      void router.navigate({ to: "/", replace: true });
    }
  }, [
    user,
    verificationAccess,
    isLoading,
    pathname,
    isPublicRoute,
    isPublicContent,
    router,
    policyState,
  ]);

  // These pages are available independently of staff session and policy state.
  // Rendering them on the server also makes the legal notice readable without JS.
  if (isPublicContent) return <Outlet />;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  // STRICT RENDER BLOCK: Make it physically impossible to render protected routes
  // while the useEffect is triggering the redirect
  if (!user && !isPublicRoute) {
    return null;
  }

  if (user && pathname === "/login") {
    return null;
  }
  if (
    user &&
    !["/privacy", "/terms", "/policy-consent", "/create-account"].includes(pathname) &&
    policyState !== "accepted"
  )
    return null;

  // Block rendering if the user's role is not allowed for this route
  if (
    user &&
    !isPublicRoute &&
    !staffRouteAllowed(pathname, !!user.staffModel, !!user.canManageSetup, !!user.legacyClassAccess)
  )
    return null;
  if (user && !isRouteAllowed(pathname, user.role)) {
    return null;
  }

  // Do not show the AppShell (sidebar) on public routes
  if (isPublicRoute) {
    return <Outlet />;
  }

  return (
    <AppShell>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </AppShell>
  );
}
