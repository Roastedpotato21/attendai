import type { StaffAccessResolution } from "./db/repositories/user";

type SupabaseAuthError = {
  code?: string | undefined;
  name?: string | undefined;
  message?: string | undefined;
  status?: number | undefined;
};

export type AuthErrorDiagnostic = {
  code: string | null;
  name: string | null;
  message: string;
  status: number | null;
};

/**
 * Produce a deliberately narrow diagnostic safe for browser console logging.
 * Do not add request data, credentials, session data, or the original error
 * object here: Supabase errors can carry response/request internals.
 */
export function authErrorDiagnostic(error: SupabaseAuthError | null): AuthErrorDiagnostic {
  const message = (error?.message ?? "Unknown Supabase Auth error")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
    .slice(0, 240);

  return {
    code: error?.code ?? null,
    name: error?.name ?? null,
    message,
    status: typeof error?.status === "number" ? error.status : null,
  };
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function signInErrorMessage(error: SupabaseAuthError | null): string {
  const code = error?.code;
  const message = error?.message ?? "";

  if (code === "email_not_confirmed" || /email\s+not\s+confirmed/i.test(message)) {
    return "Please verify your email before signing in.";
  }

  if (code === "invalid_credentials" || /invalid\s+(login\s+)?credentials/i.test(message)) {
    return "Invalid email or password.";
  }

  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    /rate\s+limit|too\s+many\s+requests/i.test(message)
  ) {
    return "Too many sign-in attempts. Please wait a moment and try again.";
  }

  return "Unable to sign in. Please try again.";
}

export function signUpErrorMessage(error: SupabaseAuthError | null): string {
  const code = error?.code;
  const message = error?.message ?? "";

  if (
    code === "user_already_exists" ||
    /already\s+(been\s+)?registered|already\s+exists/i.test(message)
  ) {
    return "An account may already exist for this email. Try signing in or resetting your password.";
  }

  if (code === "weak_password") {
    return "Choose a stronger password and try again.";
  }

  if (code === "email_address_invalid") {
    return "Enter a valid work email address.";
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    /rate\s+limit|too\s+many\s+requests/i.test(message)
  ) {
    return "Too many account-creation attempts. Please wait a moment and try again.";
  }

  return "We could not create your institution account. Please try again.";
}

export function staffAccessErrorMessage(
  reason: Exclude<StaffAccessResolution["status"], "allowed">,
): string {
  switch (reason) {
    case "profile_inactive":
    case "membership_inactive":
      return "Your staff access is currently inactive.";
    case "profile_missing":
    case "no_membership":
    case "role_missing":
      return "Your AttendAI staff account is not fully provisioned.";
    case "student_only":
      return "This account does not have access to the AttendAI staff portal.";
  }
}
