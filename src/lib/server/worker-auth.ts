import { createHash, timingSafeEqual } from "node:crypto";

export function workerAuthorized(
  method: string,
  provided: string | null,
  expected?: string,
): boolean {
  if (method !== "POST" || !expected || !provided) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(`Bearer ${expected}`));
}
