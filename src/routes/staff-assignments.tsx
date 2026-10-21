import { createFileRoute } from "@tanstack/react-router";
import { InstitutionSetupPage } from "@/components/staff/institution-setup";
export const Route = createFileRoute("/staff-assignments")({
  head: () => ({ meta: [{ title: "Roles and assignments — AttendAI" }] }),
  component: () => <InstitutionSetupPage section="assignments" />,
});
