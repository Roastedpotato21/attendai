import { createHash } from "node:crypto";

export const VERIFICATION_BUCKET = "institution-verification";
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export function inspectVerificationFile(bytes: Uint8Array, declaredMime: string, kind: string) {
  if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES)
    throw new Error("Evidence must be between 1 byte and 5 MB.");
  let mime: string;
  let extension: string;
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a"
  ) {
    mime = "image/png";
    extension = ".png";
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = "image/jpeg";
    extension = ".jpg";
  } else if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
    mime = "application/pdf";
    extension = ".pdf";
    // Quarantine is still required: this is a coarse active-content rejection, not a malware scanner.
    if (
      /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/i.test(
        Buffer.from(bytes).toString("latin1"),
      )
    ) {
      throw new Error("Active PDF content is not accepted. Upload a flattened PDF or image.");
    }
  } else throw new Error("Only PDF, JPEG and PNG evidence is accepted.");
  if (mime !== declaredMime) throw new Error("The file content does not match its declared type.");
  if (kind === "challenge_photo" && mime === "application/pdf")
    throw new Error("Challenge photos must be JPEG or PNG.");
  return { mime, extension, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function boundedVerificationBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) throw new Error("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Evidence request exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
