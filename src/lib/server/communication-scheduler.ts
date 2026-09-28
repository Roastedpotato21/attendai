const INTERNAL_WORKER_URL = "https://attendai.internal/api/internal/communications/process";

export async function runCommunicationSchedule(
  fetchInternal: (request: Request) => Promise<Response>,
  secret = process.env["COMMUNICATION_WORKER_SECRET"],
): Promise<Response> {
  if (!secret) {
    console.error("[communication-scheduler] skipped", {
      reason: "worker secret is not configured",
    });
    return new Response("Scheduler is not configured", { status: 503 });
  }

  const response = await fetchInternal(
    new Request(INTERNAL_WORKER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
  if (!response.ok) {
    console.error("[communication-scheduler] invocation failed", { status: response.status });
  }
  return response;
}
