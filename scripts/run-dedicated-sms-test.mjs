// Internal operator command. `send` uses one idempotent execution key and the
// Worker can make no more than one Fast2SMS POST for that key.
const action = process.argv[2];
if (!["preflight", "send", "inspect"].includes(action))
  throw new Error("Choose preflight, send or inspect");
if (new URL(process.env.SUPABASE_URL).hostname !== "elebygmdftfjgecauyiq.supabase.co")
  throw new Error("Unexpected Supabase project");
const response = await fetch(
  "https://attendai.attendai-expresspotato44.workers.dev/api/internal/communications/fast2sms/transport-test",
  {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: {
      Authorization: "Bearer " + process.env.COMMUNICATION_WORKER_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, executionKey: "attendai-fast2sms-transport-20261012-v1" }),
  },
);
const raw = await response.text();
// Final defense in the operator console: never print a full phone number.
console.log(
  JSON.stringify({
    httpStatus: response.status,
    response: raw.replace(/\+?\d{10,15}/g, "[redacted-number]"),
  }),
);
if (!response.ok) process.exitCode = 2;
