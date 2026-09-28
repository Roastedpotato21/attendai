import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthUser, UserRole } from "@/lib/types";
import { useRouter } from "@tanstack/react-router";
import { getDataMode, hasDatabaseConnection, supabase } from "@/lib/db/connection";
import { userRepository, type StaffAccessResolution } from "@/lib/db/repositories";
import {
  authErrorDiagnostic,
  normalizeAuthEmail,
  signInErrorMessage,
  staffAccessErrorMessage,
} from "@/lib/auth-errors";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  /** Mock login by user ID (in-memory DB only) */
  login: (userId: string) => Promise<void>;
  /** Password login (Supabase or mock fallback) — returns the AuthUser for post-login routing */
  loginWithPassword: (email: string, password: string) => Promise<AuthUser>;
  completeNewInstitutionOnboarding: () => Promise<AuthUser>;
  /** Complete a Supabase invitation and verify its institution membership and role. */
  completeInvitation: (password: string) => Promise<AuthUser>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const PORTAL_ROLES: readonly UserRole[] = ["admin", "faculty", "staff"];

function isPortalRole(role: UserRole): boolean {
  return PORTAL_ROLES.includes(role);
}

class StaffPortalAccessError extends Error {
  constructor(readonly reason: Exclude<StaffAccessResolution["status"], "allowed">) {
    super(staffAccessErrorMessage(reason));
    this.name = "StaffPortalAccessError";
  }
}

function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof Error && /fetch|network|timeout|ECONNREFUSED|ENOTFOUND/i.test(error.message)
  );
}

function isUnprovisionedAuthRoute(): boolean {
  return (
    window.location.pathname === "/accept-invite" || window.location.pathname === "/create-account"
  );
}

function onboardingError(error: { code?: string } | null): Error {
  if (error?.code === "23505") {
    return new Error("That institution code is unavailable. Choose another code.");
  }
  if (error?.code === "42501") {
    return new Error("This account cannot create an AttendAI institution.");
  }
  if (error?.code === "22023") {
    return new Error("Your institution details are invalid. Review them and try again.");
  }
  return new Error("We could not complete institution setup. Please try again.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a lean AuthUser from a DB profile row. */
function toAuthUser(dbUser: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  studentId?: string | null;
}): AuthUser {
  const u: AuthUser = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
  };
  if (dbUser.studentId) u.studentId = dbUser.studentId;
  return u;
}

function staffAccessUser(resolution: StaffAccessResolution): AuthUser {
  if (resolution.status !== "allowed") throw new StaffPortalAccessError(resolution.status);
  return toAuthUser(resolution.user);
}

// ---------------------------------------------------------------------------
// Mock-mode helpers (localStorage session, no Supabase)
// ---------------------------------------------------------------------------

const MOCK_SESSION_KEY = "mock_auth_session";

function saveMockSession(user: AuthUser) {
  if (typeof window !== "undefined") {
    localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
  }
}

function clearMockSession() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(MOCK_SESSION_KEY);
  }
}

function loadMockSession(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(MOCK_SESSION_KEY);
    const storedUser = stored ? (JSON.parse(stored) as AuthUser) : null;
    if (storedUser && !isPortalRole(storedUser.role)) {
      clearMockSession();
      return null;
    }
    return storedUser;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Cleanup guard — prevents setState on unmounted component in async callbacks
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Session initialization & auth state listener
  // -------------------------------------------------------------------------
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const initAuth = async () => {
      try {
        if (hasDatabaseConnection() && supabase) {
          // V4 FIX: Use getUser() which validates the JWT against the auth server,
          // rather than getSession() which only reads from localStorage.
          const {
            data: { user: authUser },
            error: getUserError,
          } = await supabase.auth.getUser();

          if (getUserError) {
            // V7 FIX: Distinguish "no session" from "auth server error".
            // PGRST/network errors throw; an expired/missing JWT returns error with
            // status 401 — treat that as "not authenticated" rather than a crash.
            console.warn("Auth validation failed:", getUserError.message);
            if (mountedRef.current) setUser(null);
          } else if (authUser) {
            const resolution = await userRepository.resolveStaffAccess(authUser.id);
            if (mountedRef.current) {
              if (resolution.status === "allowed") {
                setUser(staffAccessUser(resolution));
              } else if (isUnprovisionedAuthRoute()) {
                // Invite, recovery, and first-admin verification tokens are not
                // staff sessions until their trusted RPC validates the role.
                setUser(null);
              } else {
                console.warn("Staff portal session denied:", resolution.status);
                await supabase.auth.signOut();
                setUser(null);
              }
            }
          } else {
            if (mountedRef.current) setUser(null);
          }

          // Subscribe to auth state changes (tab focus, token refresh, sign-out in other tabs)
          const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (session?.user) {
              try {
                const resolution = await userRepository.resolveStaffAccess(session.user.id);
                // V6 FIX: Guard against setState after unmount
                if (mountedRef.current) {
                  if (resolution.status === "allowed") {
                    setUser(staffAccessUser(resolution));
                  } else if (isUnprovisionedAuthRoute()) {
                    setUser(null);
                  } else {
                    console.warn("Staff portal session denied:", resolution.status);
                    if (supabase) await supabase.auth.signOut();
                    setUser(null);
                  }
                }
              } catch (e) {
                console.error("Profile lookup failed in onAuthStateChange", e);
              }
            } else {
              if (mountedRef.current) setUser(null);
            }
            router.invalidate();
          });
          subscription = data.subscription;
        } else {
          // Mock auth flow — restore from localStorage
          const currentUser = loadMockSession();
          if (mountedRef.current) setUser(currentUser);
        }
      } catch (e) {
        console.error("Auth init error", e);
        if (mountedRef.current) setUser(null);
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [router]);

  // -------------------------------------------------------------------------
  // Login: mock user ID (for in-memory DB demos)
  // -------------------------------------------------------------------------
  const login = async (userId: string) => {
    if (getDataMode() !== "mock") {
      throw new Error("Mock login is available only when VITE_DATA_MODE=mock.");
    }
    const dbUser = await userRepository.findById(userId);
    if (!dbUser) throw new Error("Invalid user ID");
    if (!isPortalRole(dbUser.role)) {
      throw new Error("This portal is available only to administrators, faculty, and staff.");
    }

    const u = toAuthUser(dbUser);
    setUser(u);
    saveMockSession(u);
    router.update({ context: { ...router.options.context, auth: { user: u } } });
    router.invalidate();
  };

  // -------------------------------------------------------------------------
  // Login: email + password (Supabase or mock fallback)
  // V5 FIX: This is now the single source of truth — no module-level currentUser.
  // Returns the AuthUser so the caller can do post-login routing.
  // -------------------------------------------------------------------------
  const loginWithPassword = async (email: string, password: string): Promise<AuthUser> => {
    if (hasDatabaseConnection() && supabase) {
      // Real Supabase login
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: normalizeAuthEmail(email),
        password,
      });

      if (authError || !authData.user) {
        console.warn("Supabase password sign-in rejected", authErrorDiagnostic(authError));
        if (isNetworkFailure(authError)) {
          throw new Error("Sign-in is temporarily unavailable. Please try again.");
        }
        throw new Error(signInErrorMessage(authError));
      }

      try {
        const u = staffAccessUser(await userRepository.resolveStaffAccess(authData.user.id));
        setUser(u);
        router.update({ context: { ...router.options.context, auth: { user: u } } });
        router.invalidate();
        return u;
      } catch (error) {
        await supabase.auth.signOut();
        if (error instanceof StaffPortalAccessError) throw error;
        if (isNetworkFailure(error)) {
          throw new Error("Sign-in is temporarily unavailable. Please try again.");
        }
        throw new Error("Unable to verify staff portal access. Please try again.");
      }
    } else if (getDataMode() === "mock") {
      // Mock fallback — find user by email in the in-memory DB
      const dbUser = await userRepository.findByEmail(email);
      if (!dbUser) {
        throw new Error("Invalid email or password.");
      }
      if (!isPortalRole(dbUser.role)) {
        throw new Error("This portal is available only to administrators, faculty, and staff.");
      }

      const u = toAuthUser(dbUser);
      setUser(u);
      saveMockSession(u);
      router.update({ context: { ...router.options.context, auth: { user: u } } });
      router.invalidate();
      return u;
    }

    throw new Error("AttendAI authentication is not configured.");
  };

  // -------------------------------------------------------------------------
  // New institution onboarding
  // -------------------------------------------------------------------------
  const completeNewInstitutionOnboarding = async (): Promise<AuthUser> => {
    if (!hasDatabaseConnection() || !supabase) {
      throw new Error("Institution account creation is available only with Supabase.");
    }
    const {
      data: { user: onboardingUser },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !onboardingUser) {
      throw new Error("Verify your email using the link we sent, then try again.");
    }
    if (!onboardingUser.email_confirmed_at) {
      throw new Error("Verify your email before creating your institution.");
    }

    const { error: provisioningError } = await supabase.rpc("provision_my_new_institution");
    if (provisioningError) throw onboardingError(provisioningError);

    try {
      const u = staffAccessUser(await userRepository.resolveStaffAccess(onboardingUser.id));
      if (u.role !== "admin") {
        throw new Error("Your institution administrator access could not be verified.");
      }
      setUser(u);
      router.update({ context: { ...router.options.context, auth: { user: u } } });
      router.invalidate();
      return u;
    } catch (error) {
      // Do NOT sign out here — the user's email is verified and their auth
      // session is valid. Signing out would force them to log in again just to
      // retry provisioning. Re-throw so the create-account retry UI can handle it.
      if (error instanceof Error) throw error;
      throw new Error("Your institution administrator access could not be verified.");
    }
  };

  // -------------------------------------------------------------------------
  // Invitation and password-recovery completion
  // -------------------------------------------------------------------------
  const completeInvitation = async (password: string): Promise<AuthUser> => {
    if (!hasDatabaseConnection() || !supabase) {
      throw new Error("Invitation acceptance is available only with Supabase.");
    }
    const {
      data: { user: invitationUser },
      error: sessionError,
    } = await supabase.auth.getUser();
    if (sessionError || !invitationUser) {
      throw new Error(
        "This invitation link is invalid or has expired. Ask your administrator for a new invite.",
      );
    }
    const { data, error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError || !data.user) {
      throw new Error(passwordError?.message ?? "Unable to set your password.");
    }
    try {
      // A password-recovery session for an already active account has no
      // pending invitation; in that case access resolution below still proves
      // the account is authorized. A pending invite must activate successfully.
      const { error: activationError } = await supabase.rpc("activate_my_staff_invitation");
      const u = staffAccessUser(await userRepository.resolveStaffAccess(data.user.id));
      if (activationError && u.role !== "admin" && u.role !== "faculty" && u.role !== "staff") {
        throw activationError;
      }
      setUser(u);
      router.update({ context: { ...router.options.context, auth: { user: u } } });
      router.invalidate();
      return u;
    } catch (error) {
      await supabase.auth.signOut();
      if (error instanceof StaffPortalAccessError) throw error;
      throw new Error("Your account could not be linked to an AttendAI institution.");
    }
  };

  const sendPasswordReset = async (email: string): Promise<void> => {
    if (!hasDatabaseConnection() || !supabase) {
      // Mock mode deliberately does not pretend to send real recovery email.
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeAuthEmail(email), {
      redirectTo: new URL("/accept-invite", window.location.origin).toString(),
    });
    if (error && isNetworkFailure(error)) {
      throw new Error("AttendAI authentication is temporarily unavailable.");
    }
    // Intentionally return generic success to avoid email-account enumeration.
  };

  const logout = async () => {
    if (hasDatabaseConnection() && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
    }
    clearMockSession();
    setUser(null);
    router.update({ context: { ...router.options.context, auth: { user: null } } });
    router.invalidate();
    await router.navigate({
      to: "/login",
      search: { redirect: undefined },
      replace: true,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        loginWithPassword,
        completeNewInstitutionOnboarding,
        completeInvitation,
        sendPasswordReset,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
