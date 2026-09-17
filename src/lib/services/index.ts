/**
 * Barrel export for all services.
 *
 * Route files should import from here rather than individual service files.
 * When swapping mock implementations for real ones, only this file changes.
 */

export * from "./students";
export * from "./analytics";
export * from "./interventions";
export * from "./ai";
export * from "./attendance";
export * from "./qr";
export * from "./auth";
export * from "./faculty";
export * from "./misc";
export * from "./audit";
export * from "./escalations";
export * from "./communication";
export * from "./communication-engine";
export * from "./messages";
export * from "./voice-calls";
export * from "./templates";
export * from "./sms";

export { communication } from "./communication";
export type { SendMessageInput, PlaceCallInput, ProviderResult } from "./communication";

export { smsService } from "./sms";
export type { SmsInput, SmsResult } from "./sms";

export { studentService } from "./students";
export type { StudentService } from "./students";

export { attendanceService } from "./attendance";
export type { AttendanceService } from "./attendance";

export { escalationService } from "./escalations";
export type { EscalationService } from "./escalations";

export { voiceCallService } from "./voice-calls";
export type { VoiceCallService } from "./voice-calls";

export { messageService } from "./messages";
export type { MessageService } from "./messages";

export { facultyService } from "./faculty";
export type { FacultyService } from "./faculty";

export { templateService } from "./templates";
export type { TemplateService } from "./templates";

export { auditService } from "./audit";
export type { AuditService } from "./audit";

export { authService } from "./auth";
export type { AuthService } from "./auth";

export { qrService } from "./qr";
export type { QRService } from "./qr";

export { insightsService, integrationsService, rolesService } from "./misc";
export type { InsightsService, IntegrationsService, RolesService } from "./misc";
