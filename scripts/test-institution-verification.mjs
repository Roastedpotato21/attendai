import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  normalizeInstitutionName,
  adaptRegistryRows,
  parseRegistryCsv,
} from "../src/lib/institution-registry.ts";
import {
  inspectVerificationFile,
  MAX_EVIDENCE_BYTES,
  boundedVerificationBody,
} from "../src/lib/server/institution-verification-files.ts";
import { handleInstitutionVerificationEvidence } from "../src/lib/server/institution-verification.ts";

const row = {
  external_id: "C-FIXTURE-1",
  canonical_name: "Fictional Government College",
  institution_type: "College",
  aishe_code: "C-FIXTURE-1",
  state: "Fixture State",
  city: "Fixture City",
  official_website: "https://fixture.invalid",
  source_url: "https://aishe.gov.in/",
  source_updated_at: "2020-01-01T00:00:00Z",
  status: "active",
};
test("institution normalization supports punctuation, spacing, abbreviations and naming variants", () => {
  assert.equal(
    normalizeInstitutionName(" ST. Govt. Coll. of TECH & SCIENCE "),
    normalizeInstitutionName("Saint Government College Technology and Science"),
  );
  assert.equal(normalizeInstitutionName("Ｆｉｘｔｕｒｅ Univ."), "fixture university");
  assert.notEqual(
    normalizeInstitutionName("North College"),
    normalizeInstitutionName("South College"),
  );
});
test("AISHE is primary; UGC and AICTE adapters preserve explicit official source identities", () => {
  const aishe = adaptRegistryRows("aishe", [row])[0];
  assert.equal(aishe.aisheCode, "C-FIXTURE-1");
  assert.equal(aishe.officialDomain, "fixture.invalid");
  for (const source of ["ugc", "aicte"]) {
    const adapted = adaptRegistryRows(source, [
      {
        ...row,
        external_id: source + "-FIXTURE",
        registry_id: "11111111-1111-4111-8111-111111111111",
        source_url: source === "ugc" ? "https://ugc.gov.in/colleges" : "https://aicte-india.org/",
      },
    ])[0];
    assert.equal(adapted.registryId, "11111111-1111-4111-8111-111111111111");
    assert.equal(adapted.source, source);
  }
});
test("ambiguous normalized names remain separate import records and do not imply approval", () => {
  const records = adaptRegistryRows("aishe", [
    row,
    { ...row, external_id: "C-FIXTURE-2", aishe_code: "C-FIXTURE-2", state: "Other Fixture State" },
  ]);
  assert.equal(records.length, 2);
  assert.notEqual(records[0].externalId, records[1].externalId);
  assert.equal(
    records.some((record) => Object.hasOwn(record, "approved")),
    false,
  );
});
test("registry adapters reject spoofed sources, unknown timestamps, missing AISHE codes and untrusted URLs", () => {
  for (const source_url of [
    "https://aishe.gov.in.attacker.invalid/",
    "http://aishe.gov.in/",
    "https://attacker@aishe.gov.in/",
    "https://fake.invalid/",
  ]) {
    assert.throws(() => adaptRegistryRows("aishe", [{ ...row, source_url }]), /official/);
  }
  assert.throws(() => adaptRegistryRows("aishe", [{ ...row, aishe_code: "" }]), /AISHE code/);
  assert.throws(
    () => adaptRegistryRows("aishe", [{ ...row, source_updated_at: "2999-01-01" }]),
    /timestamp/,
  );
  assert.throws(
    () => adaptRegistryRows("aishe", [{ ...row, official_website: "javascript:alert(1)" }]),
    /official website/,
  );
});
test("CSV import handles quoted commas, multiline cells, UTF8 headers and rejects ambiguous columns", () => {
  assert.deepEqual(
    parseRegistryCsv('\uFEFFcanonical_name,state\r\n"Fictional, College","Fixture\nState"\r\n'),
    [{ canonical_name: "Fictional, College", state: "Fixture\nState" }],
  );
  assert.throws(() => parseRegistryCsv("name,name\na,b"), /headers/);
  assert.throws(() => parseRegistryCsv('name,state\n"unfinished'), /Unterminated/);
  assert.throws(() => parseRegistryCsv("name,state\na,b,c"), /mismatch/);
});
const pdf = Buffer.from("%PDF-1.7\nfixture flattened document\n%%EOF");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0wAAAABJRU5ErkJggg==",
  "base64",
);
test("evidence validation checks file signatures, exact MIME, size and photo-only formats", () => {
  assert.equal(
    inspectVerificationFile(pdf, "application/pdf", "authorization_letter").extension,
    ".pdf",
  );
  assert.equal(inspectVerificationFile(png, "image/png", "challenge_photo").extension, ".png");
  assert.throws(
    () => inspectVerificationFile(png, "application/pdf", "recognition_document"),
    /declared type/,
  );
  assert.throws(
    () => inspectVerificationFile(pdf, "application/pdf", "challenge_photo"),
    /JPEG or PNG/,
  );
  assert.throws(
    () => inspectVerificationFile(Buffer.from("<svg/>"), "image/svg+xml", "recognition_document"),
    /Only PDF/,
  );
  assert.throws(
    () =>
      inspectVerificationFile(
        new Uint8Array(MAX_EVIDENCE_BYTES + 1),
        "image/png",
        "challenge_photo",
      ),
    /5 MB/,
  );
  assert.throws(
    () =>
      inspectVerificationFile(
        Buffer.from("%PDF-1.7 /OpenAction /JavaScript"),
        "application/pdf",
        "recognition_document",
      ),
    /Active PDF/,
  );
});
test("chunked request bodies are bounded even without a content-length header", async () => {
  await assert.rejects(
    boundedVerificationBody(
      new Request("https://fixture.invalid", { method: "POST", body: new Uint8Array(10) }),
      5,
    ),
    /size limit/,
  );
});
const appId = "11111111-1111-4111-8111-111111111111",
  evidenceId = "22222222-2222-4222-8222-222222222222";
function clients({
  deny = false,
  registerFails = false,
  removeFails = false,
  verified = true,
} = {}) {
  const calls = [];
  const storage = {
    upload: async (path, bytes, options) => {
      calls.push(["upload", path, options]);
      return { error: null };
    },
    remove: async (paths) => {
      calls.push(["remove", paths]);
      return { error: removeFails ? new Error("unavailable") : null };
    },
    download: async (path) => {
      calls.push(["download", path]);
      return { data: new Blob([pdf]), error: null };
    },
  };
  return {
    calls,
    session: {
      auth: {
        getUser: async () => ({
          data: { user: { id: appId, email_confirmed_at: verified ? "2020-01-01" : null } },
          error: null,
        }),
      },
      rpc: async (name, args) => {
        calls.push([name, args]);
        return deny
          ? { data: null, error: { code: "42501" } }
          : {
              data:
                name === "verification_upload_context"
                  ? { institution_id: appId }
                  : {
                      object_path: appId + "/" + appId + "/" + evidenceId + ".pdf",
                      mime_type: "application/pdf",
                    },
              error: null,
            };
      },
    },
    service: {
      storage: {
        from: (bucket) => {
          assert.equal(bucket, "institution-verification");
          return storage;
        },
      },
      rpc: async (name, args) => {
        calls.push([name, args]);
        return {
          data: evidenceId,
          error:
            registerFails && name === "register_institution_verification_evidence"
              ? { code: "22023" }
              : null,
        };
      },
    },
  };
}
const bearer = { authorization: "Bearer fixture-not-a-real-token" };
function uploadRequest(file = new File([pdf], "letter.pdf", { type: "application/pdf" })) {
  const body = new FormData();
  body.set("applicationId", appId);
  body.set("kind", "authorization_letter");
  body.set("file", file);
  return new Request("https://fixture.invalid/api/institution-verification/evidence", {
    method: "POST",
    headers: bearer,
    body,
  });
}
test("evidence API refuses missing identity and unverified email before touching storage", async () => {
  const db = clients();
  assert.equal(
    (await handleInstitutionVerificationEvidence(new Request("https://fixture.invalid"), db))
      .status,
    401,
  );
  assert.equal(db.calls.length, 0);
  const unverified = clients({ verified: false });
  assert.equal(
    (await handleInstitutionVerificationEvidence(uploadRequest(), unverified)).status,
    401,
  );
  assert.equal(unverified.calls.length, 0);
});
test("uploads bind to authorized application paths and stay quarantined", async () => {
  const db = clients();
  const response = await handleInstitutionVerificationEvidence(uploadRequest(), db);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).scanState, "quarantined");
  const upload = db.calls.find((c) => c[0] === "upload");
  assert.match(upload[1], new RegExp("^" + appId + "/" + appId + "/"));
  const registered = db.calls.find((c) => c[0] === "register_institution_verification_evidence");
  assert.equal(registered[1].p_actor, appId);
  assert.equal(registered[1].p_kind, "authorization_letter");
  assert.equal(registered[1].p_sha256.length, 64);
  assert.equal(upload[2].upsert, false);
});
test("unauthorized application and cross-application evidence requests cannot access stored bytes", async () => {
  const denied = clients({ deny: true });
  assert.equal((await handleInstitutionVerificationEvidence(uploadRequest(), denied)).status, 403);
  assert.equal(
    (
      await handleInstitutionVerificationEvidence(
        new Request("https://fixture.invalid?id=" + evidenceId, { headers: bearer }),
        denied,
      )
    ).status,
    403,
  );
  assert.equal(
    denied.calls.some((c) => ["upload", "download"].includes(c[0])),
    false,
  );
});
test("failed metadata registration removes uploaded bytes and never reports success", async () => {
  const db = clients({ registerFails: true });
  const response = await handleInstitutionVerificationEvidence(uploadRequest(), db);
  assert.equal(response.status, 409);
  assert.equal(db.calls.filter((c) => c[0] === "remove").length, 1);
});
test("private downloads authorize and audit every access and use attachment/no-store headers", async () => {
  const db = clients();
  const response = await handleInstitutionVerificationEvidence(
    new Request("https://fixture.invalid?id=" + evidenceId, { headers: bearer }),
    db,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /^attachment;/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal(db.calls[0][0], "access_institution_verification_evidence");
  assert.equal(db.calls[1][0], "download");
});
test("deletion is tombstoned before storage removal and failed physical deletion is not confirmed", async () => {
  const db = clients({ removeFails: true });
  const response = await handleInstitutionVerificationEvidence(
    new Request("https://fixture.invalid?id=" + evidenceId, { method: "DELETE", headers: bearer }),
    db,
  );
  assert.equal(response.status, 503);
  assert.equal(db.calls[0][1].p_delete, true);
  assert.equal(
    db.calls.some((c) => c[0] === "finish_verification_evidence_deletion"),
    false,
  );
});
test("verification has no face recognition, biometric matching or public storage URL generation", async () => {
  const files = [
    "../src/lib/server/institution-verification.ts",
    "../src/routes/institution-verification.tsx",
    "../src/routes/institution-review.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /getPublicUrl|createSignedUrl|face-api|face_recognition|BiometricTemplate|compareFaces/,
    );
  }
});
