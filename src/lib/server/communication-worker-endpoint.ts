import { randomUUID } from "node:crypto";

import { processCommunicationJobs } from "./communication-worker.ts";
import { workerAuthorized } from "./worker-auth.ts";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 50;

export type WorkerRunSummary = {
  runId: string;
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  durationMs: number;
};

export function communicationWorkerBatchSize(
  value = process.env["COMMUNICATION_WORKER_BATCH_SIZE"],
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(parsed, MAX_BATCH_SIZE);
}

export async function handleCommunicationWorkerRequest(
  request: Request,
  options: {
    expectedSecret?: string;
    processJobs?: typeof processCommunicationJobs;
    runId?: string;
    batchSize?: number;
  } = {},
): Promise<Response> {
  const expectedSecret = options.expectedSecret ?? process.env["COMMUNICATION_WORKER_SECRET"];
  if (!workerAuthorized(request.method, request.headers.get("authorization"), expectedSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const runId = options.runId ?? randomUUID();
  const started = Date.now();
  try {
    const processor =
      options.processJobs ??
      (process.env["NOTIFICATION_PROVIDER"] === "fcm"
        ? (await import("./push-worker.ts")).processPushJobs
        : processCommunicationJobs);
    const result = await processor(options.batchSize ?? communicationWorkerBatchSize());
    const summary: WorkerRunSummary = { runId, ...result, durationMs: Date.now() - started };
    console.info("[communication-worker] run complete", summary);
    return Response.json(summary);
  } catch (error) {
    console.error("[communication-worker] run failed", {
      runId,
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0,
      durationMs: Date.now() - started,
      reason: error instanceof Error ? error.message : "unknown worker error",
    });
    return Response.json({ runId, error: "communication worker unavailable" }, { status: 503 });
  }
}
