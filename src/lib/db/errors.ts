/**
 * Typed error hierarchy for the repository / data-access layer.
 *
 * Every error carries enough context for the service layer to decide how to
 * react (retry? surface to user? log-and-swallow?) without leaking raw
 * database internals to the UI.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export class DatabaseError extends Error {
  /** The repository operation that failed (e.g. "student list"). */
  readonly operation: string;
  /** PostgreSQL / Supabase error code when available. */
  readonly code: string | undefined;
  /** Whether this error is safe to retry (e.g. transient network issue). */
  readonly isRetryable: boolean;

  constructor(
    operation: string,
    message: string,
    opts?: { code?: string | undefined; isRetryable?: boolean | undefined; cause?: unknown },
  ) {
    super(message, { cause: opts?.cause });
    this.name = "DatabaseError";
    this.operation = operation;
    this.code = opts?.code;
    this.isRetryable = opts?.isRetryable ?? false;
  }
}

// ---------------------------------------------------------------------------
// Concrete sub-types
// ---------------------------------------------------------------------------

/** Missing or invalid configuration (e.g. missing Supabase URL / anon key). */
export class ConfigurationError extends DatabaseError {
  constructor(operation: string, message?: string) {
    super(operation, message ?? `${operation}: invalid or missing configuration`);
    this.name = "ConfigurationError";
  }
}

/** Caller is unauthenticated or authentication session is missing/expired. */
export class AuthenticationError extends DatabaseError {
  constructor(operation: string, message?: string, code?: string) {
    super(operation, message ?? `${operation}: unauthenticated`, { code });
    this.name = "AuthenticationError";
  }
}

/** The requested entity does not exist. */
export class NotFoundError extends DatabaseError {
  constructor(operation: string, message?: string) {
    super(operation, message ?? `${operation}: entity not found`);
    this.name = "NotFoundError";
  }
}

/** RLS denied access or user lacks the required role / membership. */
export class AuthorizationError extends DatabaseError {
  constructor(operation: string, message?: string, code?: string) {
    super(operation, message ?? `${operation}: access denied`, { code });
    this.name = "AuthorizationError";
  }
}

/** Unique constraint / duplicate violation (PG 23505). */
export class ConflictError extends DatabaseError {
  constructor(operation: string, message?: string, code?: string) {
    super(operation, message ?? `${operation}: conflict / duplicate`, { code });
    this.name = "ConflictError";
  }
}

/** Check constraint, FK violation, or invalid input (PG 23xxx family). */
export class ValidationError extends DatabaseError {
  constructor(operation: string, message?: string, code?: string) {
    super(operation, message ?? `${operation}: validation failed`, { code });
    this.name = "ValidationError";
  }
}

/** Network / transient failure — safe to retry with back-off. */
export class TransientDatabaseError extends DatabaseError {
  constructor(operation: string, message?: string, opts?: { code?: string; cause?: unknown }) {
    super(operation, message ?? `${operation}: transient database/network error`, {
      code: opts?.code,
      isRetryable: true,
      cause: opts?.cause,
    });
    this.name = "TransientDatabaseError";
  }
}

/** Alias ConnectionError to TransientDatabaseError for backward compatibility. */
export class ConnectionError extends TransientDatabaseError {
  constructor(operation: string, message?: string, opts?: { cause?: unknown }) {
    super(operation, message, opts);
    this.name = "ConnectionError";
  }
}

// ---------------------------------------------------------------------------
// Supabase error shape
// ---------------------------------------------------------------------------

type SupabasePgError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

// ---------------------------------------------------------------------------
// Factory: classify a raw Supabase/PG error
// ---------------------------------------------------------------------------

/**
 * Convert a raw Supabase PostgREST / PostgreSQL error into the appropriate
 * typed `DatabaseError` sub-class.
 *
 * If called without an error object it returns a generic `DatabaseError`
 * (useful for "no data returned" situations).
 */
export function fromSupabaseError(operation: string, error?: SupabasePgError | null): DatabaseError {
  if (!error) {
    return new DatabaseError(operation, `${operation}: unexpected empty result`);
  }

  const code = error.code ?? "";
  const detail = error.details ? ` — ${error.details}` : "";
  const baseMsg = `${operation} failed (${code}): ${error.message ?? "unknown"}${detail}`;

  // Unauthenticated (PostgREST 401 or JWT expired/missing)
  if (
    code === "PGRST301" ||
    (error.message && /jwt|token expired|invalid token|unauthorized/i.test(error.message))
  ) {
    return new AuthenticationError(operation, baseMsg, code);
  }

  // RLS / authorization (PostgREST 403 or PG 42501 insufficient_privilege)
  if (
    code === "42501" ||
    code.startsWith("PGRST3") ||
    (error.message && /permission denied|row-level security/i.test(error.message))
  ) {
    return new AuthorizationError(operation, baseMsg, code);
  }

  // Unique violation
  if (code === "23505") {
    return new ConflictError(operation, baseMsg, code);
  }

  // Other constraint failures (FK, check, not-null, exclusion)
  if (code.startsWith("23")) {
    return new ValidationError(operation, baseMsg, code);
  }

  // Connection / network / transient errors
  if (
    code === "PGRST000" ||
    code === "08000" ||
    code === "08003" ||
    code === "08006" ||
    code === "57P01" ||
    (error.message && /fetch|network|timeout|ECONNREFUSED|ENOTFOUND/i.test(error.message))
  ) {
    return new TransientDatabaseError(operation, baseMsg, { code });
  }

  // Everything else → generic non-retryable
  return new DatabaseError(operation, baseMsg, { code });
}

// ---------------------------------------------------------------------------
// Legacy compat — kept so existing callers compile unchanged during migration
// ---------------------------------------------------------------------------

/** @deprecated Use `fromSupabaseError` instead. */
export function databaseOperationError(
  operation: string,
  error?: SupabasePgError | null,
): DatabaseError {
  return fromSupabaseError(operation, error);
}
