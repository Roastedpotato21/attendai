/**
 * Faculty data-access service.
 *
 * Directs all reads to the hardened facultyRepository.
 * In Supabase mode, queries Supabase and throws typed database errors.
 * In explicit mock mode, uses memoryDb.
 */

import type { Faculty } from "@/lib/types";
import { facultyRepository } from "../db/repositories";

export interface FacultyService {
  getAll(): Promise<Faculty[]>;
}

export const facultyService: FacultyService = {
  async getAll() {
    return facultyRepository.findAll();
  },
};
