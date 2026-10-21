import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { boundedVerificationBody } from "./institution-verification-files.ts";
type Clients = { session: SupabaseClient; service: SupabaseClient };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
function clients(token: string): Clients | null {
  const url = process.env["SUPABASE_URL"],
    key = process.env["VITE_SUPABASE_ANON_KEY"],
    secret = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key || !secret) return null;
  const auth = { persistSession: false, autoRefreshToken: false };
  return {
    session: createClient(url, key, {
      auth,
      global: { headers: { Authorization: "Bearer " + token } },
    }),
    service: createClient(url, secret, { auth }),
  };
}
/** Generates a private invitation for manual delivery. It never sends or claims email delivery. */
export async function handleStaffSetupInvitation(
  request: Request,
  injected?: Clients,
  appOrigin = process.env["ATTENDAI_APP_URL"],
): Promise<Response> {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return reply({ error: "Authentication required." }, 401);
  const db = injected ?? clients(authorization.slice(7));
  if (!db || !appOrigin)
    return reply({ error: "Staff invitation generation is not configured." }, 503);
  try {
    const origin = new URL(appOrigin);
    if (
      origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))
    )
      return reply({ error: "Invitation application origin is not configured securely." }, 503);
    const { data: identity, error: authError } = await db.session.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !identity.user?.email_confirmed_at)
      return reply({ error: "Verified account required." }, 401);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(await boundedVerificationBody(request, 8192)));
    } catch {
      return reply({ error: "A bounded JSON staff request is required." }, 400);
    }
    const staffId = String(body["staffId"] ?? "");
    if (!uuid.test(staffId)) return reply({ error: "Invalid staff identifier." }, 400);
    const { data: context, error: contextError } = await db.session.rpc(
      "staff_invitation_context",
      { p_staff: staffId },
    );
    if (contextError || !context)
      return reply(
        { error: "Only an active institution owner/admin can invite this staff member." },
        403,
      );
    const { data: existing, error: lookupError } = await db.service
      .from("profiles")
      .select("id")
      .eq("email", context.email)
      .maybeSingle();
    if (lookupError) return reply({ error: "Invitation identity lookup is unavailable." }, 503);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const redirect = new URL("/accept-invite", origin);
    redirect.searchParams.set("staff_invitation", token);
    const { data: generated, error: generateError } = await db.service.auth.admin.generateLink({
      type: existing ? "magiclink" : "invite",
      email: context.email,
      options: {
        redirectTo: redirect.href,
        ...(!existing ? { data: { name: context.name } } : {}),
      },
    });
    if (generateError || !generated.user || !generated.properties?.action_link)
      return reply(
        { error: "The authentication invitation link could not be generated. No email was sent." },
        503,
      );
    if (generated.user.email?.toLowerCase() !== context.email)
      return reply({ error: "Invitation identity mismatch." }, 503);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const { data: id, error: prepareError } = await db.session.rpc("prepare_staff_invitation", {
      p_staff: staffId,
      p_auth_user: generated.user.id,
      p_hash: hash,
    });
    if (prepareError)
      return reply(
        {
          error:
            "The invitation could not be registered. No active institution access was granted; retry from the staff record.",
        },
        409,
      );
    return reply(
      {
        id,
        deliveryStatus: "link_generated",
        manualDeliveryRequired: true,
        invitationLink: generated.properties.action_link,
      },
      201,
    );
  } catch {
    console.error("[staff-setup] invitation generation failed");
    return reply(
      { error: "Staff invitation generation is unavailable. No delivery was confirmed." },
      503,
    );
  }
}
