// Read-only account requests; deliberately cannot invoke trial/send endpoints.
const action = process.argv[2];
if (!["wallet", "logs"].includes(action)) throw new Error("Choose wallet or logs");
const response = await fetch(
  "https://attendai.attendai-expresspotato44.workers.dev/api/internal/communications/fast2sms/account",
  {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: "Bearer " + process.env.COMMUNICATION_WORKER_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, page: Number(process.argv[3] ?? 1) }),
  },
);
console.log(JSON.stringify({ endpointStatus: response.status, result: await response.json() }));
