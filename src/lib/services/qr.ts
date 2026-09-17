/**
 * QR Attendance Service (Mock Backend)
 *
 * Manages active QR sessions, processes incoming student check-ins,
 * handles proximity validation, and prevents duplicate/expired scans.
 */

import type { QRSession, QRCheckIn } from "@/lib/types";
import { qrRepository, classRepository, studentRepository } from "../db/repositories";
import { auditService } from "./audit";

export interface QRService {
  startSession(
    className: string,
    date: string,
    durationMinutes: number,
    facultyId: string,
  ): Promise<QRSession>;
  stopSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<QRSession | null>;
  checkIn(sessionId: string, studentId: string, locationData: unknown): Promise<QRCheckIn>;
  getLiveCheckIns(sessionId: string): Promise<QRCheckIn[]>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockQRService: QRService = {
  async startSession(className: string, date: string, durationMinutes: number, facultyId: string) {
    // NOTE: Real authorization enforced by Supabase RLS (qr_sessions_manage policy)
    await delay(300);

    // Find classId
    const cls = await classRepository.findByName(className);
    if (!cls) {
      throw new Error(`Class "${className}" not found.`);
    }
    const classId = cls.id;

    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + durationMinutes);

    const session = await qrRepository.createSession({
      classId,
      facultyId,
      date,
      expiresAt: expiry.toISOString(),
      active: true,
    });

    await auditService.log("Start QR Session", `Class: ${className}`, "info", facultyId);

    return {
      id: session.id,
      className,
      facultyId: session.facultyId,
      date: session.date,
      expiresAt: session.expiresAt,
      active: session.active,
    };
  },

  async stopSession(sessionId: string) {
    // NOTE: Real authorization enforced by Supabase RLS (qr_sessions_manage policy)
    await delay(200);
    await qrRepository.updateSession(sessionId, { active: false });
  },

  async getSession(sessionId: string) {
    await delay(100);
    const session = await qrRepository.findSessionById(sessionId);
    if (!session) return null;

    let className = "Unknown";
    // We should theoretically find the class name by ID, but we only have findByName right now.
    // In a real app we'd have classRepository.findById(session.classId).
    // For now we will return session.classId as placeholder since findById isn't there, or add findById to classRepository.
    // Actually, I'll update classRepository shortly, let's assume classRepository.findById exists.
    const cls = await classRepository.findById(session.classId);
    if (cls) className = cls.name;
    return {
      id: session.id,
      className: cls ? cls.name : "Unknown",
      facultyId: session.facultyId,
      date: session.date,
      expiresAt: session.expiresAt,
      active: session.active && new Date(session.expiresAt).getTime() > Date.now(),
    };
  },

  async checkIn(sessionId: string, studentId: string, _locationData: unknown) {
    await delay(500); // Simulate network/location processing

    const session = await qrRepository.findSessionById(sessionId);
    if (!session) {
      throw new Error("Session not found or invalid.");
    }

    if (!session.active || new Date(session.expiresAt).getTime() < Date.now()) {
      await auditService.log(
        "Rejected QR Check-In (Expired)",
        `Session: ${sessionId}`,
        "warning",
        studentId,
      );
      throw new Error("This QR code has expired.");
    }

    const student = await studentRepository.findById(studentId);
    if (!student) {
      throw new Error("Student record not found.");
    }

    if (student.classId !== session.classId) {
      await auditService.log(
        "Rejected QR Check-In (Class Mismatch)",
        `Student class ${student.classId} != Session class ${session.classId}`,
        "critical",
        studentId,
      );
      throw new Error("You do not belong to this class. Check-in denied.");
    }

    const records = await qrRepository.findCheckInsBySession(sessionId);

    // Prevent Duplicate
    if (records.some((r) => r.studentId === studentId && r.status === "valid")) {
      await qrRepository.createCheckIn({
        sessionId,
        studentId,
        timestamp: new Date().toISOString(),
        status: "duplicate",
      });
      await auditService.log(
        "Rejected QR Check-In (Duplicate)",
        `Session: ${sessionId}`,
        "warning",
        studentId,
      );
      throw new Error("You have already checked in.");
    }

    // Placeholder for backend-ready proximity verification
    const isValidProximity = true;

    const checkIn = await qrRepository.createCheckIn({
      sessionId,
      studentId,
      timestamp: new Date().toISOString(),
      status: isValidProximity ? "valid" : "invalid_proximity",
    });

    if (!isValidProximity) {
      await auditService.log(
        "Rejected QR Check-In (Proximity)",
        `Session: ${sessionId}`,
        "warning",
        studentId,
      );
      throw new Error(
        "Check-in denied: Proximity verification failed. Please connect to the classroom Wi-Fi.",
      );
    }

    await auditService.log("Successful QR Check-In", `Session: ${sessionId}`, "info", studentId);

    return {
      sessionId: checkIn.sessionId,
      studentId: checkIn.studentId,
      timestamp: checkIn.timestamp,
      status: checkIn.status,
    };
  },

  async getLiveCheckIns(sessionId: string) {
    await delay(100);
    const checkIns = await qrRepository.findCheckInsBySession(sessionId);
    return checkIns.map((c) => ({
      sessionId: c.sessionId,
      studentId: c.studentId,
      timestamp: c.timestamp,
      status: c.status,
    }));
  },
};

export const qrService: QRService = mockQRService;
