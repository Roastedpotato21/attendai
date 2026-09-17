/**
 * Template data-access service.
 *
 * ARCHITECTURAL NOTICE (Phase 3A):
 * The current PostgreSQL migration schema (00000–00005) does NOT include a `templates` table.
 * Per Requirement F of Phase 3A:
 * - We do NOT fabricate or invent a persistence table silently.
 * - This service remains EXPLICITLY mock-only for Phase 3A.
 * - A schema migration for message templates belongs to a future communication hardening phase.
 */

import type { Template } from "@/lib/types";
import { templates as seed } from "@/lib/mock-data";

export interface TemplateService {
  getAll(): Promise<Template[]>;
  update(template: Template): Promise<Template>;
  toggleActive(id: string): Promise<Template>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let mockTemplates: Template[] = [...seed];

export const mockTemplateService: TemplateService = {
  async getAll() {
    await delay(100);
    return mockTemplates;
  },

  async update(template) {
    await delay(200);
    mockTemplates = mockTemplates.map((t) => (t.id === template.id ? template : t));
    return template;
  },

  async toggleActive(id) {
    await delay(200);
    const item = mockTemplates.find((t) => t.id === id);
    if (!item) throw new Error(`Template ${id} not found`);
    const updated = { ...item, active: !item.active };
    mockTemplates = mockTemplates.map((t) => (t.id === id ? updated : t));
    return updated;
  },
};

export const templateService: TemplateService = mockTemplateService;
