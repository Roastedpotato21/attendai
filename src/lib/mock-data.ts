/**
 * Mock / seed data for AttendAI.
 *
 * This file only generates deterministic sample data.
 * Domain types are imported from `@/lib/types`.
 * Configuration constants are imported from `@/lib/config`.
 */

import { SUPPORTED_LANGUAGES, ESCALATION_LEVELS } from "@/lib/config";
import type {
  AIInsight,
  AuditLog,
  CallRecord,
  ClassAttendance,
  Escalation,
  Faculty,
  Integration,
  KPIs,
  Language,
  MessageRecord,
  RolesMatrixRow,
  Student,
  Template,
} from "@/lib/types";

// Re-export types so existing `import type { X } from "@/lib/mock-data"` still
// compiles. New code should import directly from `@/lib/types`.
export type {
  AIInsight,
  AuditLog,
  CallRecord,
  ClassAttendance,
  Escalation,
  Faculty,
  Integration,
  KPIs,
  Language,
  MessageRecord,
  RolesMatrixRow,
  Student,
  Template,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const firstNames = [
  "Aarav",
  "Sai Teja",
  "Priya",
  "Nikhil",
  "Anjali",
  "Rahul",
  "Meghana",
  "Kiran",
  "Divya",
  "Harsha",
  "Sneha",
  "Vamsi",
  "Pooja",
  "Arjun",
  "Lavanya",
  "Rohit",
  "Keerthi",
  "Manoj",
  "Swathi",
  "Ganesh",
  "Ritika",
  "Sandeep",
  "Bhavana",
  "Yashwanth",
];
const lastNames = [
  "Reddy",
  "Sharma",
  "Naidu",
  "Kumar",
  "Rao",
  "Verma",
  "Patel",
  "Chowdary",
  "Singh",
  "Iyer",
];
const languages: readonly Language[] = SUPPORTED_LANGUAGES;
const classes = ["CSE-A", "CSE-B", "ECE-A", "MECH-A", "X-A", "XII-B"];

function pick<T>(arr: readonly T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length]!;
}

function seeded(i: number, mod: number) {
  return (i * 7919 + 13) % mod;
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export const students: Student[] = Array.from({ length: 48 }, (_, i) => {
  const name = `${pick(firstNames, i % firstNames.length)} ${pick(lastNames, seeded(i, lastNames.length))}`;
  const rate = 62 + seeded(i, 37);
  const consecutive = rate < 72 ? 1 + seeded(i, 4) : seeded(i, 2);
  return {
    id: `STU-${1000 + i}`,
    name,
    roll: `21${seeded(i, 5)}A05${(10 + i).toString().padStart(2, "0")}`,
    className: pick(classes, i % classes.length),
    section: i % 2 === 0 ? "A" : "B",
    parentName: `${pick(lastNames, seeded(i, lastNames.length))} ${i % 2 === 0 ? "Srinivas" : "Lakshmi"}`,
    parentPhone: `+91 9${(800000000 + i * 137911).toString().slice(0, 9)}`,
    language: pick(languages, seeded(i, languages.length)),
    attendanceRate: rate,
    consecutiveAbsences: consecutive,
    status: i % 5 === 0 ? "absent" : i % 11 === 0 ? "late" : i % 17 === 0 ? "excused" : "present",
    risk: rate < 70 ? "high" : rate < 80 ? "medium" : "low",
  };
});

export const absentToday = students.filter((s) => s.status === "absent" || s.status === "late");

// ---------------------------------------------------------------------------
// Attendance Trends
// ---------------------------------------------------------------------------

export const attendanceTrend = [
  { day: "Mon", present: 91, absent: 9, calls: 42 },
  { day: "Tue", present: 88, absent: 12, calls: 56 },
  { day: "Wed", present: 93, absent: 7, calls: 33 },
  { day: "Thu", present: 86, absent: 14, calls: 64 },
  { day: "Fri", present: 84, absent: 16, calls: 71 },
  { day: "Sat", present: 89, absent: 11, calls: 48 },
  { day: "Sun", present: 92, absent: 8, calls: 21 },
];

export const classAttendance: ClassAttendance[] = classes.map((c, i) => ({
  className: c,
  rate: 76 + seeded(i, 20),
  absent: 3 + seeded(i, 9),
}));

export const languageSplit = [
  { name: "Telugu", value: 42 },
  { name: "English", value: 27 },
  { name: "Hindi", value: 18 },
  { name: "Tamil", value: 8 },
  { name: "Other", value: 5 },
];

// ---------------------------------------------------------------------------
// Call Records
// ---------------------------------------------------------------------------

const responses = [
  "He has fever since last night, visiting the doctor today.",
  "She is attending a family function in the village, back on Monday.",
  "We were not aware. We will make sure he attends tomorrow.",
  "Bus was missed this morning, she will join after lunch break.",
  "Please share the assignment list, he is recovering from viral.",
];

const summaries = [
  "Parent confirmed medical absence (fever). Expected return in 2 days. No follow-up call needed.",
  "Family event absence, pre-planned. Suggest marking as excused and sharing missed notes.",
  "Parent unaware of absence — potential truancy signal. Recommend faculty follow-up.",
  "Transport issue, student will attend partial day. Low concern.",
  "Health-related absence with academic support request. Share coursework.",
];

export const calls: CallRecord[] = Array.from({ length: 26 }, (_, i) => {
  const s = pick(students, (i * 3) % students.length);
  const statuses: CallRecord["status"][] = [
    "completed",
    "no-answer",
    "failed",
    "in-progress",
    "scheduled",
  ];
  const status = pick(statuses, seeded(i, 5));
  return {
    id: `CALL-${5000 + i}`,
    studentId: s.id,
    student: s.name,
    parent: s.parentName,
    language: s.language,
    startedAt: `2026-08-09 ${(8 + (i % 9)).toString().padStart(2, "0")}:${(seeded(i, 6) * 10).toString().padStart(2, "0")}`,
    durationSec: status === "completed" ? 45 + seeded(i, 120) : 0,
    attempts: 1 + seeded(i, 3),
    status,
    sentiment:
      status === "completed"
        ? pick(["cooperative", "concerned", "neutral"] as const, seeded(i, 3))
        : "unreachable",
    parentResponse: status === "completed" ? pick(responses, seeded(i, responses.length)) : "—",
    aiSummary:
      status === "completed"
        ? pick(summaries, seeded(i, summaries.length))
        : "No response captured. Retry scheduled.",
  };
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const messages: MessageRecord[] = Array.from({ length: 30 }, (_, i) => {
  const s = pick(students, (i * 5) % students.length);
  const statuses: MessageRecord["status"][] = ["delivered", "read", "sent", "failed"];
  return {
    id: `MSG-${7000 + i}`,
    channel: i % 3 === 0 ? "SMS" : "WhatsApp",
    student: s.name,
    parentPhone: s.parentPhone,
    language: s.language,
    template:
      i % 4 === 0
        ? "Absence Alert"
        : i % 4 === 1
          ? "Late Arrival"
          : i % 4 === 2
            ? "Low Attendance Warning"
            : "Escalation Notice",
    sentAt: `2026-08-09 ${(8 + (i % 10)).toString().padStart(2, "0")}:${(seeded(i, 6) * 10).toString().padStart(2, "0")}`,
    status: pick(statuses, seeded(i, 4)),
    body: `Dear Parent, ${s.name} (${s.className}) was marked absent today. Please confirm the reason. — AttendAI`,
  };
});

// ---------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------

export const escalations: Escalation[] = Array.from({ length: 12 }, (_, i) => {
  const s = pick(students, (i * 7) % students.length);
  const levels: Escalation["level"][] = [...ESCALATION_LEVELS];
  const statuses: Escalation["status"][] = ["open", "acknowledged", "resolved"];
  return {
    id: `ESC-${300 + i}`,
    student: s.name,
    className: s.className,
    reason:
      i % 3 === 0
        ? "3+ consecutive absences"
        : i % 3 === 1
          ? "Parent unreachable after 3 calls"
          : "Attendance below 65%",
    level: pick(levels, seeded(i, 4)),
    raisedAt: `2026-08-0${1 + (i % 9)} 09:${(seeded(i, 6) * 10).toString().padStart(2, "0")}`,
    owner: pick(
      ["Dr. Meera Rao", "Prof. K. Sharma", "Ms. Anitha N", "Mr. Ravi Teja"],
      seeded(i, 4),
    ),
    status: pick(statuses, seeded(i, 3)),
  };
});

// ---------------------------------------------------------------------------
// Faculty
// ---------------------------------------------------------------------------

export const faculty: Faculty[] = [
  {
    id: "F-01",
    name: "Dr. Meera Rao",
    email: "meera.rao@attendai.edu",
    department: "Computer Science",
    classes: ["CSE-A", "CSE-B"],
    role: "HOD",
  },
  {
    id: "F-02",
    name: "Prof. K. Sharma",
    email: "k.sharma@attendai.edu",
    department: "Electronics",
    classes: ["ECE-A"],
    role: "Class Teacher",
  },
  {
    id: "F-03",
    name: "Ms. Anitha N",
    email: "anitha.n@attendai.edu",
    department: "Mathematics",
    classes: ["X-A", "XII-B"],
    role: "Faculty",
  },
  {
    id: "F-04",
    name: "Mr. Ravi Teja",
    email: "ravi.teja@attendai.edu",
    department: "Mechanical",
    classes: ["MECH-A"],
    role: "Class Teacher",
  },
  {
    id: "F-05",
    name: "Dr. Sudha Kiran",
    email: "sudha.kiran@attendai.edu",
    department: "Administration",
    classes: [],
    role: "Admin",
  },
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templates: Template[] = [
  {
    id: "T-01",
    name: "Absence Alert",
    channel: "SMS",
    language: "English",
    updatedAt: "2026-08-02",
    active: true,
    body: "Dear {{parent_name}}, {{student_name}} was absent on {{date}}. Reply with the reason or expect a call from AttendAI.",
  },
  {
    id: "T-02",
    name: "Absence Alert",
    channel: "WhatsApp",
    language: "Telugu",
    updatedAt: "2026-08-04",
    active: true,
    body: "ప్రియమైన {{parent_name}} గారు, {{student_name}} ఈ రోజు ({{date}}) పాఠశాలకు హాజరు కాలేదు. దయచేసి కారణం తెలియజేయండి.",
  },
  {
    id: "T-03",
    name: "Voice Call Script",
    channel: "Voice",
    language: "Hindi",
    updatedAt: "2026-08-05",
    active: true,
    body: "नमस्ते {{parent_name}} जी, यह {{school_name}} की ओर से स्वचालित कॉल है। {{student_name}} आज अनुपस्थित हैं। कृपया कारण बताइए।",
  },
  {
    id: "T-04",
    name: "Low Attendance Warning",
    channel: "SMS",
    language: "English",
    updatedAt: "2026-07-28",
    active: true,
    body: "{{student_name}}'s attendance is {{attendance_rate}}%, below the {{threshold}}% requirement. Please contact the class teacher.",
  },
  {
    id: "T-05",
    name: "Escalation Notice",
    channel: "WhatsApp",
    language: "English",
    updatedAt: "2026-07-21",
    active: false,
    body: "This is an escalation notice regarding {{student_name}}'s continued absence. A meeting has been requested with {{faculty_name}}.",
  },
  {
    id: "T-06",
    name: "Voice Call Script",
    channel: "Voice",
    language: "Telugu",
    updatedAt: "2026-08-06",
    active: true,
    body: "నమస్కారం, ఇది {{school_name}} నుండి AttendAI కాల్. {{student_name}} ఈరోజు హాజరు కాలేదు. దయచేసి కారణం చెప్పండి.",
  },
];

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

export const auditLogs: AuditLog[] = Array.from({ length: 22 }, (_, i) => {
  const actions = [
    "Marked attendance for CSE-A",
    "Triggered AI voice call batch",
    "Updated WhatsApp template",
    "Exported attendance report",
    "Changed escalation policy",
    "Granted role: Class Teacher",
    "Deleted student record",
  ];
  const sev: AuditLog["severity"][] = ["info", "info", "warning", "critical"];
  return {
    id: `LOG-${9000 + i}`,
    actor: pick(faculty, seeded(i, faculty.length)).name,
    action: pick(actions, seeded(i, actions.length)),
    target: pick(students, (i * 4) % students.length).id,
    ip: `10.24.${seeded(i, 200)}.${seeded(i, 250)}`,
    at: `2026-08-09 ${(7 + (i % 12)).toString().padStart(2, "0")}:${(seeded(i, 6) * 10).toString().padStart(2, "0")}`,
    severity: pick(sev, seeded(i, 4)),
  };
});

// ---------------------------------------------------------------------------
// AI Insights
// ---------------------------------------------------------------------------

export const aiInsights: AIInsight[] = [
  {
    id: "IN-1",
    title: "Friday absenteeism spike",
    detail:
      "Absences rise 62% on Fridays across CSE-A and MECH-A. Consider scheduling attendance-critical sessions earlier in the week.",
    impact: "high",
    metric: "+62%",
  },
  {
    id: "IN-2",
    title: "Telugu voice calls convert best",
    detail:
      "Parent response rate is 81% for Telugu voice calls vs 58% for English SMS. Prioritise native-language voice for high-risk cases.",
    impact: "medium",
    metric: "81%",
  },
  {
    id: "IN-3",
    title: "9 students trending toward detention",
    detail:
      "Nine students will drop below the 75% threshold within 12 days at their current rate. Early escalation recommended.",
    impact: "high",
    metric: "9 students",
  },
  {
    id: "IN-4",
    title: "Retry window optimisation",
    detail: "Calls retried between 6–8 PM are answered 2.3x more often than mid-day retries.",
    impact: "medium",
    metric: "2.3x",
  },
];

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export const kpis: KPIs = {
  attendanceToday: 91.4,
  absentToday: absentToday.length,
  callsToday: 128,
  callSuccess: 78.5,
  messagesSent: 412,
  openEscalations: escalations.filter((e) => e.status === "open").length,
  parentsReached: 86.2,
  avgResponseMin: 12,
};

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export const integrations: Integration[] = [
  {
    id: "twilio",
    name: "Twilio Voice",
    category: "Voice",
    status: "not-connected",
    description: "Outbound multilingual AI voice calls to parents.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business API",
    category: "Messaging",
    status: "not-connected",
    description: "Template messaging and two-way parent replies.",
  },
  {
    id: "msg91",
    name: "MSG91 SMS",
    category: "Messaging",
    status: "not-connected",
    description: "Transactional SMS delivery with DLT templates.",
  },
  {
    id: "elevenlabs",
    name: "Voice Synthesis",
    category: "AI",
    status: "not-connected",
    description: "Natural multilingual TTS for call scripts.",
  },
  {
    id: "erp",
    name: "School ERP Sync",
    category: "Data",
    status: "not-connected",
    description: "Sync students, classes and attendance registers.",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    category: "Data",
    status: "not-connected",
    description: "Holiday and exam calendar awareness.",
  },
];

// ---------------------------------------------------------------------------
// Roles & Permissions
// ---------------------------------------------------------------------------

export const rolesMatrix: RolesMatrixRow[] = [
  {
    role: "Admin",
    attendance: "Full",
    students: "Full",
    ai: "Full",
    reports: "Full",
    settings: "Full",
  },
  {
    role: "HOD",
    attendance: "Full",
    students: "Full",
    ai: "Approve",
    reports: "Full",
    settings: "View",
  },
  {
    role: "Class Teacher",
    attendance: "Edit",
    students: "Edit",
    ai: "Trigger",
    reports: "View",
    settings: "None",
  },
  {
    role: "Faculty",
    attendance: "Edit",
    students: "View",
    ai: "View",
    reports: "View",
    settings: "None",
  },
  {
    role: "Counselor",
    attendance: "View",
    students: "View",
    ai: "View",
    reports: "View",
    settings: "None",
  },
];
