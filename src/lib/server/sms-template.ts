/** Server-only rendering for institution-owned, approved SMS templates. */

export type SmsTemplate = {
  id: string;
  institution_id: string;
  event_type: string;
  channel: string;
  language: string;
  content: string;
  approved_variables: string[];
  active: boolean;
};

export type SmsVariables = {
  institution_name: string;
  guardian_name: string;
  student_name: string;
  attendance_date: string;
};

const ALLOWED_VARIABLES = new Set<keyof SmsVariables>([
  "institution_name",
  "guardian_name",
  "student_name",
  "attendance_date",
]);

export function renderSmsTemplate(template: SmsTemplate, values: SmsVariables): string {
  if (!template.active || template.channel !== "sms" || template.event_type !== "absence-alert") {
    throw new Error("SMS template is inactive or does not match the event");
  }
  if (!Array.isArray(template.approved_variables) || !template.content.trim()) {
    throw new Error("SMS template has no approved content or variables");
  }
  const approved = new Set(template.approved_variables);
  if (
    approved.size !== template.approved_variables.length ||
    [...approved].some((key) => !ALLOWED_VARIABLES.has(key as keyof SmsVariables))
  ) {
    throw new Error("SMS template declares an unsupported variable");
  }
  const used = new Set<string>();
  const rendered = template.content.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (_match, rawKey: string) => {
      const key = rawKey.trim() as keyof SmsVariables;
      if (!ALLOWED_VARIABLES.has(key) || !approved.has(key)) {
        throw new Error("SMS template contains an unapproved variable");
      }
      const value = values[key];
      if (
        !value ||
        !value.trim() ||
        /^(undefined|null|unknown)$/i.test(value.trim()) ||
        /[{}]/.test(value) ||
        [...value].some((character) => character.charCodeAt(0) < 32)
      ) {
        throw new Error("SMS template variable is missing or invalid");
      }
      used.add(key);
      return value.trim();
    },
  );
  if (
    !used.has("student_name") ||
    !used.has("attendance_date") ||
    /\{\{|\}\}|(^|[\s,])(?:undefined|null)(?=$|[\s,.])/i.test(rendered) ||
    [...rendered].length > 280
  ) {
    throw new Error("SMS template output is incomplete or too long");
  }
  return rendered;
}
