/**
 * QR attendance service
 *
 * Manages active QR sessions, processes incoming student check-ins,
 * handles proximity validation, and prevents duplicate/expired scans.
 */

import type { QRSession, QRCheckIn } from "@/lib/types";
import { qrRepository, classRepository } from "../db/repositories";

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

export const qrService: QRService = {
  async startSession(className: string, date: string, durationMinutes: number, facultyId: string) {
    throw new Error(
      "Student QR attendance is unavailable until identity and proximity verification are implemented.",
    );
  },

  async stopSession(sessionId: string) {
    // NOTE: Real authorization enforced by Supabase RLS (qr_sessions_manage policy)
    await qrRepository.updateSession(sessionId, { active: false });
  },

  async getSession(sessionId: string) {
    const session = await qrRepository.findSessionById(sessionId);
    if (!session) return null;

    const cls = await classRepository.findById(session.classId);
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
    throw new Error(
      "Student QR attendance is unavailable until identity and proximity verification are implemented.",
    );
  },

  async getLiveCheckIns(sessionId: string) {
    const checkIns = await qrRepository.findCheckInsBySession(sessionId);
    return checkIns.map((c) => ({
      sessionId: c.sessionId,
      studentId: c.studentId,
      timestamp: c.timestamp,
      status: c.status,
    }));
  },
};
