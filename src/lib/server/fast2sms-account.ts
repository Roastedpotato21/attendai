/** Read-only provider diagnostics. No send URL, arbitrary URL, or account mutation. */
export function redactFast2Sms(value: string): string {
  const secret = process.env["FAST2SMS_API_KEY"];
  let result = secret ? value.split(secret).join("[redacted]") : value;
  // Redact secret fragments too, if configuration accidentally contains line endings.
  for (const part of secret?.split(/\s+/).filter((x) => x.length >= 8) ?? [])
    result = result.split(part).join("[redacted]");
  return result.replace(/\+?\d{10,15}/g, "[recipient]").replace(/[\r\n]/g, " ");
}

export async function readFast2SmsAccount(request: Request): Promise<Response> {
  const input = await request.json().catch(() => null);
  const secret = process.env["FAST2SMS_API_KEY"];
  if (!secret) return Response.json({ error: "Missing provider credential" }, { status: 503 });
  if (!["wallet", "logs"].includes(input?.action))
    return new Response("Invalid read-only action", { status: 400 });
  const page = Number(input?.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100)
    return new Response("Invalid page", { status: 400 });
  const path =
    input.action === "wallet"
      ? "/dev/wallet"
      : `/dev/sms_logs?from=2026-10-11&to=2026-10-12&limit=100&page=${page}`;
  const started = Date.now();
  let status: number | null = null;
  let stage = "fetch";
  try {
    const response = await fetch("https://www.fast2sms.com" + path, {
      method: input.action === "wallet" ? "POST" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: secret, Accept: "application/json" },
    });
    status = response.status;
    stage = "read_body";
    const raw = await response.text();
    return Response.json(
      {
        action: input.action,
        httpStatus: status,
        contentType: response.headers.get("content-type"),
        elapsedMs: Date.now() - started,
        // Mask before returning even to the authenticated operator.
        safeBody: redactFast2Sms(raw).slice(0, 100000),
        truncated: raw.length > 100000,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        action: input.action,
        httpStatus: status,
        stage,
        elapsedMs: Date.now() - started,
        error: redactFast2Sms(
          error instanceof Error ? `${error.name}: ${error.message}` : "Unknown transport error",
        ).slice(0, 1000),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
