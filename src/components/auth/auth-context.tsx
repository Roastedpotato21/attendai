import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthUser, UserRole } from "@/lib/types";
import { useRouter } from "@tanstack/react-router";
import { hasDatabaseConnection, supabase } from "@/lib/db/connection";
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
  verificationAccess: boolean;
  /** Password login — returns the AuthUser for post-login routing */
  loginWithPassword: (email: string, password: string) => Promise<AuthUser | null>;
  /** Complete a Supabase invitation and verify its institution membership and role. */
  completeInvitation: (password: string, staffInvitation?: string) => Promise<AuthUser | null>;
  sendPasswordReset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
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
  return [
    "/accept-invite",
    "/create-account",
    "/institution-verification",
    "/institution-review",
  ].includes(window.location.pathname);
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
  staffModel?: boolean;
  institutionId?: string;
  setupRoles?: string[];
  canManageSetup?: boolean;
  legacyClassAccess?: boolean;
}): AuthUser {
  const u: AuthUser = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
  };
  if (dbUser.staffModel !== undefined) u.staffModel = dbUser.staffModel;
  if (dbUser.institutionId !== undefined) u.institutionId = dbUser.institutionId;
  if (dbUser.setupRoles !== undefined) u.setupRoles = dbUser.setupRoles;
  if (dbUser.canManageSetup !== undefined) u.canManageSetup = dbUser.canManageSetup;
  if (dbUser.legacyClassAccess !== undefined) u.legacyClassAccess = dbUser.legacyClassAccess;
  if (dbUser.studentId) u.studentId = dbUser.studentId;
  return u;
}

function staffAccessUser(resolution: StaffAccessResolution): AuthUser {
  if (resolution.status !== "allowed") throw new StaffPortalAccessError(resolution.status);
  return toAuthUser(resolution.user);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [verificationAccess, setVerificationAccess] = useState(false);

  const allowVerificationSession = async () => {
    const { data, error } = await supabase.rpc("my_institution_verification_access");
    const allowed = !error && data?.allowed === true;
    if (mountedRef.current) setVerificationAccess(allowed);
    return allowed;
  };
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
            if (mountedRef.current) {
              setUser(null);
              setVerificationAccess(false);
            }
          } else if (authUser) {
            const resolution = await userRepository.resolveStaffAccess(authUser.id);
            if (mountedRef.current) {
              if (resolution.status === "allowed") {
                setUser(staffAccessUser(resolution));
                setVerificationAccess(false);
              } else if ((await allowVerificationSession()) || isUnprovisionedAuthRoute()) {
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
            if (mountedRef.current) {
              setUser(null);
              setVerificationAccess(false);
            }
          }

          // Subscribe to auth state changes (tab focus, token refresh, sign-out in other tabs)
          const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            window.setTimeout(() => {
              void (async () => {
                if (session?.user) {
                  try {
                    const resolution = await userRepository.resolveStaffAccess(session.user.id);
                    // V6 FIX: Guard against setState after unmount
                    if (mountedRef.current) {
                      if (resolution.status === "allowed") {
                        setUser(staffAccessUser(resolution));
                        setVerificationAccess(false);
                      } else if ((await allowVerificationSession()) || isUnprovisionedAuthRoute()) {
                        setUser(null);
                      } else {
                        console.warn("Staff portal session denied:", resolution.status);
                        if (supabase) await supabase.auth.signOut();
                        setUser(null);
                      }
                    }
                  } catch (e) {
                    console.error("Profile lookup failed in onAuthStateChange", e);
                    if (mountedRef.current) {
                      setUser(null);
                      setVerificationAccess(false);
                    }
                  }
                } else {
                  if (mountedRef.current) {
                    setUser(null);
                    setVerificationAccess(false);
                  }
                }
                router.invalidate();
              })().catch(() => {
                if (mountedRef.current) {
                  setUser(null);
                  setVerificationAccess(false);
                }
              });
            }, 0);
          });
          subscription = data.subscription;
        }
      } catch (e) {
        console.error("Auth init error", e);
        if (mountedRef.current) {
          setUser(null);
          setVerificationAccess(false);
        }
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

  // Recheck live database grants after owner/role changes in another session.
  // RLS/RPC checks enforce revocation immediately, independently of this refresh.
  useEffect(() => {
    if (!user?.staffModel) return;
    let live = true;
    let running = false;
    const refreshAccess = async () => {
      if (running) return;
      running = true;
      try {
        const { data } = await supabase.auth.getUser();
        const access = data.user ? await userRepository.resolveStaffAccess(data.user.id) : null;
        if (!live) return;
        if (access?.status === "allowed") setUser(staffAccessUser(access));
        else {
          setUser(null);
          setVerificationAccess(false);
        }
      } catch {
        if (live) {
          setUser(null);
          setVerificationAccess(false);
        }
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void refreshAccess(), 30_000);
    const focus = () => void refreshAccess();
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [user?.id, user?.staffModel, user?.institutionId]);

  // -------------------------------------------------------------------------
  // Login: email + password
  // V5 FIX: This is now the single source of truth — no module-level currentUser.
  // Returns the AuthUser so the caller can do post-login routing.
  // -------------------------------------------------------------------------
  const loginWithPassword = async (email: string, password: string): Promise<AuthUser | null> => {
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
        const resolution = await userRepository.resolveStaffAccess(authData.user.id);
        if (resolution.status !== "allowed" && (await allowVerificationSession())) {
          setUser(null);
          return null;
        }
        const u = staffAccessUser(resolution);
        setVerificationAccess(false);
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
    }

    throw new Error("AttendAI authentication is not configured.");
  };

  // -------------------------------------------------------------------------
  // Invitation and password-recovery completion
  // -------------------------------------------------------------------------
  const completeInvitation = async (
    password: string,
    staffInvitation?: string,
  ): Promise<AuthUser | null> => {
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
      const activation = staffInvitation
        ? await supabase.rpc("accept_staff_setup_invitation", { p_token: staffInvitation })
        : await supabase.rpc("activate_my_staff_invitation");
      const activationError = activation.error;
      if (staffInvitation && activationError) throw activationError;
      if (!activationError && typeof activation.data === "string") {
        window.localStorage.setItem("attendai:selected-institution", activation.data);
      }
      const resolution = await userRepository.resolveStaffAccess(data.user.id);
      if (resolution.status !== "allowed" && (await allowVerificationSession())) {
        setUser(null);
        return null;
      }
      const u = staffAccessUser(resolution);
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
      throw new Error("AttendAI authentication is not configured.");
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
    window.localStorage.removeItem("attendai:selected-institution");
    window.sessionStorage.removeItem("attendai:staff-invitation");
    if (hasDatabaseConnection() && supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw new Error(error.message);
    }
    setVerificationAccess(false);
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
        verificationAccess,
        loginWithPassword,
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
