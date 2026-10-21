import { createFileRoute } from "@tanstack/react-router";
import { StaffWorkspacePage } from "@/components/staff/staff-workspace";
export const Route = createFileRoute("/staff-profile")({
  head: () => ({ meta: [{ title: "Your staff profile — AttendAI" }] }),
  component: StaffWorkspacePage,
});
