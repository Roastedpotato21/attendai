import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { handleStaffSetupInvitation } from "../src/lib/server/staff-setup.ts";
import {
  handleStaffInvitationRequest,
  handleStaffManagementRequest,
} from "../src/lib/server/staff-invitations.ts";
import { staffRouteAllowed, institutionDay, currentRoleGrant } from "../src/lib/staff-setup.ts";
const staffId = "91000000-0000-4000-8000-000000000001";
const identityId = "91000000-0000-4000-8000-000000000002";
const bearer = { Authorization: "Bearer fixture-token", "Content-Type": "application/json" };
test("dated roles use institution dates and exclude expired, scheduled or closed grants", () => {
  const date = institutionDay("Asia/Kolkata", new Date("2026-10-20T20:00:00Z"));
  assert.equal(date, "2026-10-21");
  const role = { active: true, valid_from: "2026-10-21", valid_until: null };
  assert.equal(currentRoleGrant(role, date), true);
  assert.equal(currentRoleGrant({ ...role, valid_from: "2026-10-22" }, date), false);
  assert.equal(currentRoleGrant({ ...role, valid_until: "2026-10-20" }, date), false);
  assert.equal(currentRoleGrant({ ...role, active: false }, date), false);
  assert.equal(currentRoleGrant({ ...role, ended_on: "2026-10-20" }, date), false);
  assert.equal(currentRoleGrant({ ...role, ended_on: date }, date), true);
  assert.equal(staffRouteAllowed("/attendance", true, false, true), true);
  assert.equal(staffRouteAllowed("/messages", true, false, true), false);
});
function request(body = { staffId }, headers = bearer) {
  return new Request("https://fixture.invalid/api/institution-setup/staff-invitation", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
function clients(options = {}) {
  const calls = [];
  let generateOptions;
  const session = {
    auth: {
      getUser: async () => ({
        data: {
          user: { id: identityId, email_confirmed_at: options.unverified ? null : "2020-01-01" },
        },
        error: options.authError ? {} : null,
      }),
    },
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "staff_invitation_context")
        return {
          data: options.denied
            ? null
            : { id: staffId, email: "staff@fixture.invalid", name: "Fixture Staff" },
          error: options.denied ? {} : null,
        };
      return { data: "fixture-invitation", error: options.prepareFails ? {} : null };
    },
  };
  const service = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: options.existing ? { id: identityId } : null,
            error: null,
          }),
        }),
      }),
    }),
    auth: {
      admin: {
        generateLink: async (args) => {
          generateOptions = args;
          calls.push(["generateLink", args]);
          return {
            data: options.generateFails
              ? {}
              : {
                  user: {
                    id: identityId,
                    email: options.wrongIdentity
                      ? "someone-else@fixture.invalid"
                      : "staff@fixture.invalid",
                  },
                  properties: {
                    action_link:
                      "https://auth.fixture.invalid/verify?redirect_to=" +
                      encodeURIComponent(args.options.redirectTo),
                  },
                },
            error: options.generateFails ? {} : null,
          };
        },
      },
    },
  };
  return {
    session,
    service,
    calls,
    get generateOptions() {
      return generateOptions;
    },
  };
}
test("managed staff routes expose their workspace while management remains admin-only", () => {
  for (const path of [
    "/institution-profile",
    "/departments",
    "/programs",
    "/staff",
    "/staff-assignments",
    "/students",
    "/attendance",
    "/messages",
    "/audit-logs",
  ]) {
    assert.equal(staffRouteAllowed(path, true, false), false, path);
    assert.equal(staffRouteAllowed(path, true, true), true, path);
  }
  assert.equal(staffRouteAllowed("/staff-profile", true, false), true);
  assert.equal(staffRouteAllowed("/", true, false), true);
  assert.equal(staffRouteAllowed("/attendance", false, false), true);
});
test("invitation API rejects unauthenticated and unverified identities", async () => {
  assert.equal(
    (await handleStaffSetupInvitation(request({}, {}), clients(), "https://fixture.invalid"))
      .status,
    401,
  );
  assert.equal(
    (
      await handleStaffSetupInvitation(
        request(),
        clients({ unverified: true }),
        "https://fixture.invalid",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleStaffSetupInvitation(
        request(),
        clients({ authError: true }),
        "https://fixture.invalid",
      )
    ).status,
    401,
  );
});
test("missing or insecure invitation origin fails explicitly", async () => {
  assert.equal((await handleStaffSetupInvitation(request(), clients(), "")).status, 503);
  assert.equal(
    (await handleStaffSetupInvitation(request(), clients(), "http://public.fixture.invalid"))
      .status,
    503,
  );
});
test("malformed and oversized staff invitation requests are bounded", async () => {
  for (const body of [{ staffId: "not-a-uuid" }, { staffId, padding: "x".repeat(9000) }]) {
    const db = clients();
    assert.equal(
      (await handleStaffSetupInvitation(request(body), db, "https://fixture.invalid")).status,
      400,
    );
    assert.equal(db.calls.length, 0);
  }
});
test("owner/admin authorization is checked before privileged identity generation", async () => {
  const db = clients({ denied: true });
  const result = await handleStaffSetupInvitation(request(), db, "https://fixture.invalid");
  assert.equal(result.status, 403);
  assert.equal(
    db.calls.some((c) => c[0] === "generateLink"),
    false,
  );
});
test("new staff invitation generates a private link, hashes a random token and never claims delivery", async () => {
  const db = clients();
  const response = await handleStaffSetupInvitation(request(), db, "https://fixture.invalid");
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.deliveryStatus, "link_generated");
  assert.equal(result.manualDeliveryRequired, true);
  assert.equal(Object.hasOwn(result, "delivered"), false);
  assert.equal(Object.hasOwn(result, "sent"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(db.generateOptions.type, "invite");
  const redirect = new URL(db.generateOptions.options.redirectTo);
  assert.equal(redirect.pathname, "/accept-invite");
  const raw = redirect.searchParams.get("staff_invitation");
  assert.match(raw, /^[0-9a-f]{64}$/);
  const registered = db.calls.find((c) => c[0] === "prepare_staff_invitation")[1];
  assert.equal(registered.p_hash, createHash("sha256").update(raw).digest("hex"));
  assert.notEqual(registered.p_hash, raw);
  assert.equal(registered.p_auth_user, identityId);
  const { invitationLink, ...metadata } = result;
  assert.ok(invitationLink.includes(raw));
  assert.equal(JSON.stringify(metadata).includes(raw), false);
  const second = clients();
  await handleStaffSetupInvitation(request(), second, "https://fixture.invalid");
  assert.notEqual(second.generateOptions.options.redirectTo, db.generateOptions.options.redirectTo);
});
test("an existing identity gets an account verification link without duplicate people", async () => {
  const db = clients({ existing: true });
  assert.equal(
    (await handleStaffSetupInvitation(request(), db, "https://fixture.invalid")).status,
    201,
  );
  assert.equal(db.generateOptions.type, "magiclink");
  assert.equal(Object.hasOwn(db.generateOptions.options, "data"), false);
});
test("failed Auth generation and mismatched identity never register or expose an invitation", async () => {
  for (const options of [{ generateFails: true }, { wrongIdentity: true }]) {
    const db = clients(options);
    const response = await handleStaffSetupInvitation(request(), db, "https://fixture.invalid");
    assert.equal(response.status, 503);
    assert.equal(
      db.calls.some((c) => c[0] === "prepare_staff_invitation"),
      false,
    );
    assert.equal(Object.hasOwn(await response.json(), "invitationLink"), false);
  }
});
test("a failed registration cannot masquerade as a sent invitation", async () => {
  const db = clients({ prepareFails: true });
  const response = await handleStaffSetupInvitation(request(), db, "https://fixture.invalid");
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(Object.hasOwn(body, "invitationLink"), false);
  assert.equal(Object.hasOwn(body, "delivered"), false);
});
test("legacy staff write endpoints cannot bypass the new invitation/role model", async () => {
  assert.equal((await handleStaffInvitationRequest(request())).status, 410);
  assert.equal(
    (
      await handleStaffManagementRequest(
        new Request("https://fixture.invalid", { method: "PATCH" }),
      )
    ).status,
    410,
  );
});
