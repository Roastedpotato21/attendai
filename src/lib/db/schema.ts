import type {
  UserRole,
  Language,
  StudentStatus,
  RiskLevel,
  CallStatus,
  CallSentiment,
  MessageChannel,
  MessageStatus,
  EscalationLevel,
  EscalationStatus,
  FacultyRole,
  TemplateChannel,
  AuditSeverity,
} from "@/lib/types";

// Base table interface with audit fields
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantEntity extends BaseEntity {
  institutionId: string;
}

// ---------------------------------------------------------------------------
// Type helpers for repository insert / update signatures
// ---------------------------------------------------------------------------

/** Fields managed by the database — excluded from insert payloads. */
export type DbInsert<T extends TenantEntity> = Omit<
  T,
  "id" | "institutionId" | "createdAt" | "updatedAt"
>;

/** Partial update payload — id and audit fields are never updatable. */
export type DbUpdate<T extends BaseEntity> = Partial<Omit<T, "id" | "createdAt" | "updatedAt">>;

// ---------------------------------------------------------------------------
// Identity & Access Management
// ---------------------------------------------------------------------------

export interface DbUser extends BaseEntity {
  name: string;
  email: string;
  role: UserRole;
  authUserId?: string | null;
  studentId?: string | null; // For student accounts
}

export interface DbInstitution extends BaseEntity {
  name: string;
  code: string;
  status: "active" | "inactive" | "suspended";
}

export interface DbProfileInstitution {
  profileId: string;
  institutionId: string;
  status: "active" | "inactive" | "suspended";
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbProfileRole {
  profileId: string;
  institutionId: string;
  roleCode: UserRole;
  assignedAt: string;
  assignedBy?: string | null;
}

// ---------------------------------------------------------------------------
// Academic Entities
// ---------------------------------------------------------------------------

export interface DbClass extends TenantEntity {
  name: string; // e.g., "BTech CSE"
  section: string; // e.g., "A"
  fullName: string; // e.g., "BTech CSE - A"
  academicYear?: string;
  active?: boolean;
}

export type DatabaseFacultyRole = "hod" | "professor" | "assistant_professor" | "lecturer";

export interface DbFaculty extends TenantEntity {
  userId: string;
  department: string;
  role: DatabaseFacultyRole;
  employeeCode?: string | null;
  active?: boolean;
}

// Join table for Faculty <-> Classes
export interface DbClassFaculty extends TenantEntity {
  facultyId: string;
  classId: string;
}

export interface DbParent extends TenantEntity {
  userId?: string | null;
  name: string;
  phone: string;
  language: Language;
  preferredChannel: "sms" | "whatsapp" | "voice";
  email?: string | null;
  active?: boolean;
}

type DatabaseStudentStatus = Exclude<StudentStatus, "unmarked">;

export interface DbStudent extends TenantEntity {
  parentId: string;
  classId: string;
  name: string;
  roll: string;
  attendanceRate: number;
  consecutiveAbsences: number;
  status: DatabaseStudentStatus;
  risk: RiskLevel;
  admissionNumber?: string | null;
  enrollmentStatus?: "active" | "inactive" | "graduated" | "withdrawn";
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface DbAttendanceSession extends TenantEntity {
  classId: string;
  date: string; // YYYY-MM-DD
  method: "manual" | "qr" | "face";
  totalPresent: number;
  totalAbsent: number;
  totalLate: number;
  submittedBy?: string | null;
  submittedAt?: string | null;
  status?: "draft" | "submitted" | "locked";
}

export interface DbAttendanceRecord extends TenantEntity {
  sessionId: string;
  studentId: string;
  status: DatabaseStudentStatus;
}

// ---------------------------------------------------------------------------
// QR Tracking
// ---------------------------------------------------------------------------

export interface DbQRSession extends TenantEntity {
  classId: string;
  facultyId: string;
  date: string;
  expiresAt: string;
  active: boolean;
}

export interface DbQRCheckIn extends TenantEntity {
  sessionId: string;
  studentId: string;
  timestamp: string;
  status: "valid" | "invalid_proximity" | "duplicate";
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export interface DbCommunication extends TenantEntity {
  studentId: string;
  parentId: string;
  type: "voice" | "sms" | "whatsapp";

  // Voice specific
  durationSec?: number | null;
  attempts?: number | null;
  callStatus?: CallStatus | null;
  sentiment?: CallSentiment | null;
  parentResponse?: string | null;
  aiSummary?: string | null;

  // Message specific
  messageStatus?: MessageStatus | null;
  templateId?: string | null;
  body?: string | null;

  // SMS specific
  providerMessageId?: string | null;
  smsStatus?: MessageStatus | null;
  parentPhone?: string | null;
  providerName?: string | null;

  // Unified Error Details
  errorDetails?: string | null;
  direction?: "outbound" | "inbound";
  scheduledFor?: string | null;
  processedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DbTemplate extends BaseEntity {
  name: string;
  channel: TemplateChannel;
  language: Language;
  body: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Escalations & Audits
// ---------------------------------------------------------------------------

export interface DbIntervention extends TenantEntity {
  studentId: string;
  riskLevel: RiskLevel;
  reason: string;
  status: "pending" | "in-progress" | "resolved";
  actionTaken?: string | null;
  actionDate?: string | null;
  ownerId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  communicationId?: string | null;
  dueAt?: string | null;
  resolvedAt?: string | null;
}

export interface DbEscalation extends TenantEntity {
  studentId: string;
  classId: string;
  reason: string;
  level: EscalationLevel;
  ownerId: string | null; // References a profile when assigned
  status: EscalationStatus;
  interventionId?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

export interface DbAuditLog extends TenantEntity {
  actorId: string | null; // References User when the action has an actor
  action: string;
  target: string;
  ip: string;
  severity: AuditSeverity;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}
