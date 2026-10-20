import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  inspectVerificationFile,
  boundedVerificationBody,
  VERIFICATION_BUCKET,
  MAX_EVIDENCE_BYTES,
} from "./institution-verification-files.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
type Clients = { session: SupabaseClient; service: SupabaseClient };
function configuredClients(token: string): Clients | null {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const publicKey = process.env["VITE_SUPABASE_ANON_KEY"];
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !publicKey || !secret) return null;
  const auth = { persistSession: false, autoRefreshToken: false };
  return {
    session: createClient(url, publicKey, {
      auth,
      global: { headers: { Authorization: "Bearer " + token } },
    }),
    service: createClient(url, secret, { auth }),
  };
}

/** Storage proxy: every byte access requires a verified bearer and an audited database authorization. */
export async function handleInstitutionVerificationEvidence(
  request: Request,
  injected?: Clients,
): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    return json({ error: "Authentication required." }, 401);
  const clients = injected ?? configuredClients(authorization.slice(7));
  if (!clients) return json({ error: "Private evidence storage is not configured." }, 503);
  const { session, service } = clients;
  try {
    const { data: identity, error: authError } = await session.auth.getUser(authorization.slice(7));
    if (authError || !identity.user?.email_confirmed_at)
      return json({ error: "Verified account required." }, 401);
    if (request.method === "POST") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.startsWith("multipart/form-data;"))
        return json({ error: "Multipart evidence upload required." }, 415);
      const bytes = await boundedVerificationBody(request, MAX_EVIDENCE_BYTES + 1024 * 1024);
      const multipart = new Request(request.url, {
        method: "POST",
        headers: { "content-type": contentType },
        body: Buffer.from(bytes),
      });
      const form = await multipart.formData();
      const applicationId = String(form.get("applicationId") ?? "");
      const kind = String(form.get("kind") ?? "");
      const challengeId = String(form.get("challengeId") ?? "");
      const file = form.get("file");
      if (
        !uuid.test(applicationId) ||
        !["authorization_letter", "recognition_document", "challenge_photo"].includes(kind) ||
        !(file instanceof File) ||
        form.getAll("file").length !== 1 ||
        (kind === "challenge_photo" && !uuid.test(challengeId))
      )
        return json({ error: "Invalid evidence request." }, 400);
      const { data: context, error: contextError } = await session.rpc(
        "verification_upload_context",
        { p_id: applicationId },
      );
      if (contextError || !context)
        return json({ error: "Application is unavailable or not editable." }, 403);
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const inspected = inspectVerificationFile(fileBytes, file.type, kind);
      const id = crypto.randomUUID();
      const objectPath =
        context.institution_id + "/" + applicationId + "/" + id + inspected.extension;
      const originalName = file.name.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 150) || "evidence";
      const { error: uploadError } = await service.storage
        .from(VERIFICATION_BUCKET)
        .upload(objectPath, fileBytes, {
          contentType: inspected.mime,
          upsert: false,
          cacheControl: "0",
        });
      if (uploadError) return json({ error: "Private evidence upload failed." }, 503);
      const { error: registrationError } = await service.rpc(
        "register_institution_verification_evidence",
        {
          p_actor: identity.user.id,
          p_application: applicationId,
          p_id: id,
          p_kind: kind,
          p_path: objectPath,
          p_name: originalName,
          p_mime: inspected.mime,
          p_size: fileBytes.length,
          p_sha256: inspected.sha256,
          p_challenge: kind === "challenge_photo" ? challengeId : null,
        },
      );
      if (registrationError) {
        // Failed registrations must not leave an accessible object. Cleanup failures remain private and logged.
        const { error: cleanupError } = await service.storage
          .from(VERIFICATION_BUCKET)
          .remove([objectPath]);
        if (cleanupError)
          console.error("[institution-verification] orphan cleanup required", { objectPath });
        return json(
          {
            error:
              "Evidence was not registered. The challenge may have expired, been reused, or the application changed.",
          },
          409,
        );
      }
      return json({ id, scanState: "quarantined" }, 201);
    }
    if (request.method === "GET" || request.method === "DELETE") {
      const id = new URL(request.url).searchParams.get("id") ?? "";
      if (!uuid.test(id)) return json({ error: "Invalid evidence identifier." }, 400);
      const { data: access, error: accessError } = await session.rpc(
        "access_institution_verification_evidence",
        {
          p_id: id,
          p_delete: request.method === "DELETE",
        },
      );
      if (accessError || !access) return json({ error: "Evidence is unavailable." }, 403);
      if (request.method === "DELETE") {
        const { error: removeError } = await service.storage
          .from(VERIFICATION_BUCKET)
          .remove([access.object_path]);
        if (removeError)
          return json(
            {
              error: "Deletion is pending. Private access has been revoked; retry deletion later.",
            },
            503,
          );
        const { error: completeError } = await service.rpc(
          "finish_verification_evidence_deletion",
          { p_id: id },
        );
        if (completeError) return json({ error: "Deletion confirmation is pending." }, 503);
        return new Response(null, { status: 204, headers });
      }
      const { data: blob, error: downloadError } = await service.storage
        .from(VERIFICATION_BUCKET)
        .download(access.object_path);
      if (downloadError || !blob) return json({ error: "Evidence download unavailable." }, 503);
      return new Response(blob, {
        headers: {
          "content-type": access.mime_type,
          "content-disposition": 'attachment; filename="verification-evidence"',
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      /Evidence |Only PDF|file content|Challenge photos|Active PDF|Missing request|declared type/i.test(
        message,
      )
    )
      return json({ error: message }, 400);
    console.error("[institution-verification] evidence request failed");
    return json({ error: "Evidence service unavailable." }, 503);
  }
}
