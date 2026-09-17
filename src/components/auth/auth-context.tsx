import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthUser, UserRole } from "@/lib/types";
import { useRouter } from "@tanstack/react-router";
import { hasDatabaseConnection, supabase } from "@/lib/db/connection";
import { userRepository } from "@/lib/db/repositories";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  /** Mock login by user ID (in-memory DB only) */
  login: (userId: string) => Promise<void>;
  /** Password login (Supabase or mock fallback) — returns the AuthUser for post-login routing */
  loginWithPassword: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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
    return stored ? (JSON.parse(stored) as AuthUser) : null;
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
          } else if (authUser?.email) {
            const dbUser = await userRepository.findByEmail(authUser.email);
            if (mountedRef.current) {
              setUser(dbUser ? toAuthUser(dbUser) : null);
            }
          } else {
            if (mountedRef.current) setUser(null);
          }

          // Subscribe to auth state changes (tab focus, token refresh, sign-out in other tabs)
          const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (session?.user?.email) {
              try {
                const dbUser = await userRepository.findByEmail(session.user.email);
                // V6 FIX: Guard against setState after unmount
                if (mountedRef.current) {
                  setUser(dbUser ? toAuthUser(dbUser) : null);
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
    setIsLoading(true);
    try {
      const dbUser = await userRepository.findById(userId);
      if (!dbUser) throw new Error("Invalid user ID");

      const u = toAuthUser(dbUser);
      setUser(u);
      saveMockSession(u);
      router.update({ context: { ...router.options.context, auth: { user: u } } });
      router.invalidate();
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Login: email + password (Supabase or mock fallback)
  // V5 FIX: This is now the single source of truth — no module-level currentUser.
  // Returns the AuthUser so the caller can do post-login routing.
  // -------------------------------------------------------------------------
  const loginWithPassword = async (email: string, password: string): Promise<AuthUser> => {
    setIsLoading(true);
    try {
      if (hasDatabaseConnection() && supabase) {
        // Real Supabase login
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError || !authData.user) {
          throw new Error(authError?.message || "Login failed");
        }

        const dbUser = await userRepository.findByEmail(authData.user.email!);
        if (!dbUser) {
          await supabase.auth.signOut();
          throw new Error("No user profile found for this email.");
        }

        const u = toAuthUser(dbUser);
        setUser(u);
        router.update({ context: { ...router.options.context, auth: { user: u } } });
        router.invalidate();
        return u;
      } else {
        // Mock fallback — find user by email in the in-memory DB
        const dbUser = await userRepository.findByEmail(email);
        if (!dbUser) {
          throw new Error("Invalid email or password.");
        }

        const u = toAuthUser(dbUser);
        setUser(u);
        saveMockSession(u);
        router.update({ context: { ...router.options.context, auth: { user: u } } });
        router.invalidate();
        return u;
      }
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------
  const logout = async () => {
    setIsLoading(true);
    try {
      if (hasDatabaseConnection() && supabase) {
        await supabase.auth.signOut();
      }
      clearMockSession();
      setUser(null);
      router.invalidate();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginWithPassword, logout }}>
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
