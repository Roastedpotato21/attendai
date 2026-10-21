/**
 * Central domain types for AttendAI.
 *
 * Every type used across routes and services lives here so that domain models
 * are shared by the data services and the UI.
 */

import type { SUPPORTED_LANGUAGES } from "@/lib/config";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Student & Attendance
// ---------------------------------------------------------------------------

export type StudentStatus = "present" | "absent" | "late" | "excused" | "unmarked";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Student = {
  id: string;
  name: string;
  roll: string;
  className: string;
  section: string;
  parentName: string | null;
  parentPhone: string | null;
  language: Language | null;
  attendanceRate: number | null;
  consecutiveAbsences: number;
  status: StudentStatus;
  risk: RiskLevel | "unknown";
};

export type AttendanceTrend = {
  day: string;
  present: number;
  absent: number;
  calls: number;
};

export type ClassAttendance = {
  className: string;
  rate: number;
  absent: number;
};

export type AttendanceRecord = {
  studentId: string;
  status: StudentStatus;
};

export type AttendanceSubmission = {
  date: string; // YYYY-MM-DD
  classId?: string;
  sessionId?: string | undefined;
  expectedRevision?: number | undefined;
  className: string;
  method: "faculty" | "qr" | "ai";
  records: AttendanceRecord[];
};

export type AttendanceSubmissionResult = {
  sessionId?: string;
  revision?: number | undefined;
  updated?: boolean;
  success: boolean;
  message: string;
  totalPresent: number;
  totalAbsent: number;
  totalLate: number;
};

// ---------------------------------------------------------------------------
// QR Attendance
// ---------------------------------------------------------------------------

export type QRSession = {
  id: string;
  className: string;
  facultyId: string;
  date: string;
  expiresAt: string;
  active: boolean;
};

export type QRCheckIn = {
  sessionId: string;
  studentId: string;
  timestamp: string;
  status: "valid" | "invalid_proximity" | "duplicate";
};

export type LanguageSplit = {
  name: string;
  value: number;
};

// ---------------------------------------------------------------------------
// Voice Calls
// ---------------------------------------------------------------------------

export type CallStatus =
  "simulated" | "unconfirmed" | "completed" | "no-answer" | "failed" | "in-progress" | "scheduled";
export type CallSentiment = "unknown" | "cooperative" | "concerned" | "neutral" | "unreachable";

export type CallRecord = {
  id: string;
  studentId: string;
  student: string;
  parent: string;
  language: Language;
  startedAt: string;
  durationSec: number;
  attempts: number;
  status: CallStatus;
  sentiment: CallSentiment;
  parentResponse: string;
  aiSummary: string;
};

// ---------------------------------------------------------------------------
// Auth & RBAC
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "faculty" | "student" | "staff";

export type AuthUser = {
  staffModel?: boolean;
  institutionId?: string;
  setupRoles?: string[];
  canManageSetup?: boolean;
  legacyClassAccess?: boolean;
  id: string;
  name: string;
  email: string;
  role: UserRole;
  studentId?: string; // Links this user to a student record if they are a student
};

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export type MessageChannel = "SMS" | "WhatsApp" | "Push";
export type MessageStatus =
  | "simulated"
  | "queued"
  | "delivered"
  | "read"
  | "sent"
  | "failed"
  | "undelivered"
  | "unconfirmed"
  | "provider_accepted"
  | "no_registered_device"
  | "suppressed"
  | "dead_letter";

export type MessageRecord = {
  id: string;
  channel: MessageChannel;
  student: string;
  parentPhone: string;
  language: Language;
  template: string;
  sentAt: string;
  status: MessageStatus;
  body: string;
};

// ---------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------

export type EscalationLevel = "L1 Faculty" | "L2 Counselor" | "L3 Head of Dept" | "L4 Principal";
export type EscalationStatus = "open" | "acknowledged" | "resolved";

export type Escalation = {
  id: string;
  student: string;
  className: string;
  reason: string;
  level: EscalationLevel;
  raisedAt: string;
  owner: string;
  status: EscalationStatus;
};

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

export type InterventionStatus = "pending" | "in-progress" | "resolved";

export type Intervention = {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  riskLevel: RiskLevel;
  reason: string;
  status: InterventionStatus;
  actionTaken?: string;
  actionDate?: string;
  createdAt: string;
  ownerId?: string;
};

// ---------------------------------------------------------------------------
// Faculty
// ---------------------------------------------------------------------------

export type FacultyRole = "Faculty" | "Class Teacher" | "HOD" | "Admin";

export type Faculty = {
  id: string;
  name: string;
  email: string;
  department: string;
  classes: string[];
  role: FacultyRole;
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type TemplateChannel = "SMS" | "WhatsApp" | "Voice";

export type Template = {
  id: string;
  name: string;
  channel: TemplateChannel;
  language: Language;
  updatedAt: string;
  body: string;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditLog = {
  id: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
  at: string;
  severity: AuditSeverity;
};

// ---------------------------------------------------------------------------
// AI Insights
// ---------------------------------------------------------------------------

export type AIInsight = {
  id: string;
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
  metric: string;
};

export type AIActionRecommendation = {
  action: string;
  type: "communication" | "intervention" | "meeting";
};

export type StudentAIInsight = {
  summary: string;
  riskExplanation: string;
  unusualPatterns: string[];
  recommendedActions: AIActionRecommendation[];
};

export type ClassAIInsight = {
  id: string;
  type: "summary" | "anomaly" | "trend";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
};

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export type KPIs = {
  attendanceToday: number | null;
  absentToday: number;
  callsToday: number;
  callSuccess: number | null;
  messagesSent: number;
  openEscalations: number;
  parentsReached: number;
  avgResponseMin: number | null;
};

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export type IntegrationStatus = "connected" | "not-connected" | "error";

export type Integration = {
  id: string;
  name: string;
  category: string;
  status: IntegrationStatus;
  description: string;
};

// ---------------------------------------------------------------------------
// Roles & Permissions
// ---------------------------------------------------------------------------

export type PermissionLevel = "Full" | "Edit" | "View" | "Approve" | "Trigger" | "None";

export type RolesMatrixRow = {
  role: string;
  attendance: PermissionLevel;
  students: PermissionLevel;
  ai: PermissionLevel;
  reports: PermissionLevel;
  settings: PermissionLevel;
};

// ---------------------------------------------------------------------------
// Student Dashboard
// ---------------------------------------------------------------------------

export type StudentDashboardData = {
  overallPercentage: number | null;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  history: Array<{
    id: string;
    date: string;
    status: StudentStatus;
    className: string;
  }>;
};

// ---------------------------------------------------------------------------
// Analytics Dashboard
// ---------------------------------------------------------------------------

export type ClassAttendanceStat = {
  classId: string;
  className: string;
  percentage: number;
};

export type StudentRiskProfile = {
  studentId: string;
  name: string;
  className: string;
  attendancePercentage: number;
  consecutiveAbsences: number;
  riskLevel: RiskLevel;
};

export type AnalyticsDashboardData = {
  classWiseAttendance: ClassAttendanceStat[];
  atRiskStudents: StudentRiskProfile[];
};
