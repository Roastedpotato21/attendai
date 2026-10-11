import { createClient } from "@supabase/supabase-js";

const expectedRef = "elebygmdftfjgecauyiq";
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || new URL(url).hostname !== `${expectedRef}.supabase.co` || !serviceKey) {
  throw new Error(
    "The configured service connection is not the expected AttendAI development project",
  );
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
  },
});

async function read(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.code} ${error.message}`);
  return data;
}

const links = await read(
  db
    .from("student_parents")
    .select("student_id,parent_id,institution_id,receives_notifications")
    .limit(1000),
  "guardian relationships",
);
const byParent = new Map();
for (const link of links) {
  const group = byParent.get(link.parent_id) ?? [];
  group.push(link);
  byParent.set(link.parent_id, group);
}
const candidates = [...byParent.entries()].filter(([, group]) => group.length === 3);
if (candidates.length !== 1) {
  console.log(
    JSON.stringify({
      projectRef: expectedRef,
      candidateGuardiansWithThreeStudents: candidates.length,
    }),
  );
  process.exit(0);
}

const [parentId, relationships] = candidates[0];
const parent = await read(
  db
    .from("parents")
    .select("id,institution_id,phone,language,preferred_channel,communication_consent,active")
    .eq("id", parentId)
    .single(),
  "guardian",
);
const institution = await read(
  db.from("institutions").select("id,name,status").eq("id", parent.institution_id).single(),
  "institution",
);
const students = await read(
  db
    .from("students")
    .select("id,institution_id,enrollment_status")
    .in(
      "id",
      relationships.map((link) => link.student_id),
    ),
  "linked students",
);
const phone = String(parent.phone ?? "");
const normalized = /^\+[0-9 ()-]+$/.test(phone) ? phone.replace(/[ ()-]/g, "") : "";
const validNormalized = /^\+[1-9]\d{7,14}$/.test(normalized);

const templateResult = await db
  .from("sms_templates")
  .select("id,institution_id,event_type,channel,language,active")
  .eq("institution_id", parent.institution_id)
  .eq("event_type", "absence-alert")
  .eq("channel", "sms")
  .eq("active", true);
const templateTableExists = !templateResult.error;
const templates = templateResult.data ?? [];
const selected =
  templates.find((item) => item.language === parent.language) ??
  templates.find((item) => item.language === "en");

const callback = process.env.TWILIO_WEBHOOK_PUBLIC_URL;
let callbackHttps = false;
let callbackPath = null;
if (callback) {
  try {
    const parsed = new URL(callback);
    callbackHttps = parsed.protocol === "https:";
    callbackPath = parsed.pathname;
  } catch {
    /* Report the invalid configuration without printing it. */
  }
}
const allowlist = (process.env.SMS_LIVE_RECIPIENT_ALLOWLIST ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
console.log(
  JSON.stringify({
    projectRef: expectedRef,
    institution: { id: institution.id, name: institution.name, status: institution.status },
    guardian: {
      id: parent.id,
      active: parent.active,
      phonePresent: phone.length > 0,
      phoneStoredAsStrictE164: /^\+[1-9]\d{7,14}$/.test(phone),
      phoneAcceptedByWorker: validNormalized,
      indianDestination: normalized.startsWith("+91"),
      communicationConsent: parent.communication_consent,
      preferredChannel: parent.preferred_channel,
      preferredLanguage: parent.language,
      notificationEligibleLinks: relationships.filter((link) => link.receives_notifications).length,
      totalLinks: relationships.length,
      activeLinkedStudents: students.filter((student) => student.enrollment_status === "active")
        .length,
    },
    templates: {
      tableExists: templateTableExists,
      activeSameLanguage: templates.some((item) => item.language === parent.language),
      activeEnglishFallback: templates.some((item) => item.language === "en"),
      selectedLanguage: selected?.language ?? null,
    },
    serverConfiguration: {
      twilioAccountSidPresent: Boolean(process.env.TWILIO_ACCOUNT_SID),
      twilioAuthTokenPresent: Boolean(process.env.TWILIO_AUTH_TOKEN),
      senderPresent: Boolean(process.env.TWILIO_PHONE_NUMBER),
      deliveryModePresent: Boolean(process.env.SMS_DELIVERY_MODE),
      liveModeEnabled: process.env.SMS_DELIVERY_MODE === "live",
      allowlistPresent: allowlist.length > 0,
      guardianAllowlisted: validNormalized && allowlist.includes(normalized),
      callbackConfigured: Boolean(callback),
      callbackHttps,
      callbackPath,
      indiaDltFlagVerified: process.env.SMS_INDIA_DLT_READY === "true",
    },
  }),
);
