/**
 * Centralized configuration for AttendAI.
 *
 * All magic strings and duplicated constants live here so they can be
 * swapped for environment variables or a remote config service later.
 */

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export const APP_NAME = "AttendAI";
export const APP_TAGLINE = "Attendance Intelligence";

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * All supported parent-communication languages.
 * This is the single source of truth — selectors and services
 * all reference this array.
 */
export const SUPPORTED_LANGUAGES = [
  "English",
  "Telugu",
  "Hindi",
  "Tamil",
  "Kannada",
  "Urdu",
] as const;

export const DEFAULT_LANGUAGE = "Telugu" as const;

// ---------------------------------------------------------------------------
// Attendance Policy
// ---------------------------------------------------------------------------

export const ATTENDANCE_THRESHOLD = 75;

// ---------------------------------------------------------------------------
// Escalation Workflow
// ---------------------------------------------------------------------------

export const ESCALATION_LEVELS = [
  "L1 Faculty",
  "L2 Counselor",
  "L3 Head of Dept",
  "L4 Principal",
] as const;

// ---------------------------------------------------------------------------
// SMS Configuration
// ---------------------------------------------------------------------------

/**
 * SMS Provider configuration for India
 * Supports MSG91 API for sending SMS
 *
 * Environment Variables:
 * - SMS_PROVIDER_API_KEY: MSG91 API authentication key (required for production)
 * - SMS_PROVIDER_ROUTE: MSG91 route ID (1=transactional, 4=promotional, default=4)
 */
export const SMS_CONFIG = {
  provider: "fast2sms" as const,
  enabled: false,
  deduplicationEnabled: true,
};
