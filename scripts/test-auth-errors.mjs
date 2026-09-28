import assert from "node:assert/strict";
import test from "node:test";

import {
  authErrorDiagnostic,
  normalizeAuthEmail,
  signInErrorMessage,
  signUpErrorMessage,
  staffAccessErrorMessage,
} from "../src/lib/auth-errors.ts";

test("signup and login normalize the same email", () => {
  assert.equal(normalizeAuthEmail("  New.Admin@Example.COM  "), "new.admin@example.com");
});

test("unverified email is not reported as a bad password", () => {
  assert.equal(
    signInErrorMessage({ code: "email_not_confirmed", message: "Email not confirmed" }),
    "Please verify your email before signing in.",
  );
  assert.equal(
    signInErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" }),
    "Invalid email or password.",
  );
});

test("signup errors distinguish duplicate and invalid input", () => {
  assert.match(signUpErrorMessage({ code: "user_already_exists" }), /already exist/i);
  assert.equal(
    signUpErrorMessage({ code: "email_address_invalid" }),
    "Enter a valid work email address.",
  );
});

test("authorization errors identify provisioning and inactive access", () => {
  assert.equal(
    staffAccessErrorMessage("no_membership"),
    "Your AttendAI staff account is not fully provisioned.",
  );
  assert.equal(
    staffAccessErrorMessage("membership_inactive"),
    "Your staff access is currently inactive.",
  );
  assert.equal(
    staffAccessErrorMessage("student_only"),
    "This account does not have access to the AttendAI staff portal.",
  );
});

test("auth diagnostics expose only safe Supabase error fields", () => {
  assert.deepEqual(
    authErrorDiagnostic({
      code: "invalid_credentials",
      name: "AuthApiError",
      message: "Invalid login credentials for person@example.com Bearer secret-value",
      status: 400,
    }),
    {
      code: "invalid_credentials",
      name: "AuthApiError",
      message: "Invalid login credentials for [email] Bearer [redacted]",
      status: 400,
    },
  );
});
