/**
 * Centralized route → role authorization mapping.
 *
 * Both the sidebar (app-sidebar.tsx) and per-route beforeLoad guards
 * consume this config so the authorization rules are defined in one place.
 *
 * These are CLIENT-SIDE UX CONTROLS ONLY. Real authorization is enforced
 * by Supabase RLS policies, profile_roles, and profile_institutions.
 */

import type { UserRole } from "@/lib/types";

export interface RouteAuthRule {
  /** Allowed roles. If undefined, any authenticated user can access. */
  allowedRoles?: UserRole[];
  /** If true, this route is accessible without authentication. */
  public?: boolean;
}

/**
 * Map of pathname → authorization rule.
 *
 * Routes not listed here default to "any authenticated user".
 */
export const routeAuth: Record<string, RouteAuthRule> = {
  // Public routes (no auth required)
  "/login": { public: true },
  "/create-account": { public: true },
  "/institution-verification": { public: true },
  "/institution-review": { public: true },
  "/accept-invite": { public: true },
  "/check-in": { public: true },
  "/guardian-notifications": { public: true },
  "/privacy": { public: true },
  "/terms": { public: true },
  "/policy-consent": { public: true },

  // Overview
  "/": { allowedRoles: ["admin", "faculty", "staff"] },
  "/student-dashboard": { allowedRoles: ["admin", "faculty", "staff"] },
  "/attendance": { allowedRoles: ["admin", "faculty"] },
  "/period-attendance": { allowedRoles: ["admin", "faculty", "staff"] },
  "/timetable": { allowedRoles: ["admin", "faculty", "staff"] },
  "/students": { allowedRoles: ["admin", "faculty", "staff"] },
  "/student-import": { allowedRoles: ["admin"] },
  "/cohorts": { allowedRoles: ["admin"] },
  "/student-promotion": { allowedRoles: ["admin", "faculty", "staff"] },
  "/guardian-devices": { allowedRoles: ["admin", "staff"] },

  // AI Communication
  "/voice-calls": { allowedRoles: ["admin", "staff"] },
  "/messages": { allowedRoles: ["admin", "staff", "faculty"] },
  "/insights": { allowedRoles: ["admin"] },
  "/templates": { allowedRoles: ["admin"] },

  // Operations
  "/analytics": { allowedRoles: ["admin", "faculty", "staff"] },
  "/interventions": { allowedRoles: ["admin", "faculty", "staff"] },
  "/escalations": { allowedRoles: ["admin", "staff"] },
  "/reports": { allowedRoles: ["admin", "faculty", "staff"] },
  "/faculty": { allowedRoles: ["admin"] },
  "/staff-profile": { allowedRoles: ["admin", "faculty", "staff"] },
  "/institution-profile": { allowedRoles: ["admin"] },
  "/departments": { allowedRoles: ["admin"] },
  "/programs": { allowedRoles: ["admin"] },
  "/staff": { allowedRoles: ["admin"] },
  "/staff-assignments": { allowedRoles: ["admin"] },

  // Administration
  "/integrations": { allowedRoles: ["admin"] },
  "/roles": { allowedRoles: ["admin"] },
  "/audit-logs": { allowedRoles: ["admin"] },
  "/settings": { allowedRoles: ["admin"] },
};

/**
 * Check whether a user role is allowed to access a given route.
 * Returns true if the route is public, or if the user's role is in the allowed list.
 * Returns false if the user is not authenticated and the route is not public.
 */
export function isRouteAllowed(pathname: string, role: UserRole | undefined): boolean {
  const rule = routeAuth[pathname];
  if (!rule) return true; // Unlisted routes: allow any authenticated user
  if (rule.public) return true;
  if (!role) return false;
  if (!rule.allowedRoles) return true; // No role restriction
  return rule.allowedRoles.includes(role);
}

/** Returns the list of public route pathnames. */
export function getPublicRoutes(): string[] {
  return Object.entries(routeAuth)
    .filter(([, rule]) => rule.public)
    .map(([path]) => path);
}
