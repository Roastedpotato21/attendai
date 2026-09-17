/**
 * Auth service interface.
 *
 * loginWithPassword and session management are handled by AuthProvider
 * (auth-context.tsx). This module retains only the mock-login-by-ID helper
 * (used by the in-memory DB demo flow) and the Supabase signOut call.
 *
 * The module-level `currentUser` that previously caused dual-state bugs
 * has been removed. React context is the single source of truth.
 */

import { hasDatabaseConnection, supabase } from "../db/connection";

export interface AuthService {
  /** Sign out from Supabase (if connected) and clear any mock session data. */
  logout(): Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const authService: AuthService = {
  async logout() {
    if (hasDatabaseConnection() && supabase) {
      await supabase.auth.signOut();
    } else {
      await delay(200);
    }
    // Mock session cleanup is handled by auth-context.tsx clearMockSession()
  },
};
