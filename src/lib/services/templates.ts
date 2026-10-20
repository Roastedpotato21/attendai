import type { Template } from "@/lib/types";

export interface TemplateService {
  getAll(): Promise<Template[]>;
  update(template: Template): Promise<Template>;
  toggleActive(id: string): Promise<Template>;
}

// No persistent custom-template store has been implemented yet.
export const templateService = {
  async getAll(): Promise<Template[]> {
    return [];
  },
  async update(_template: Template): Promise<Template> {
    throw new Error("Custom template editing is not available.");
  },
  async toggleActive(_id: string): Promise<Template> {
    throw new Error("Custom template editing is not available.");
  },
};
