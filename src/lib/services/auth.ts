import { requireSupabase } from "../db/connection";
export interface AuthService {
  logout(): Promise<void>;
}
export const authService: AuthService = {
  async logout() {
    const { error } = await requireSupabase().auth.signOut();
    if (error) throw error;
  },
};
