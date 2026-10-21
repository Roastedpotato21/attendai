import { createFileRoute } from "@tanstack/react-router";
import { InstitutionSetupPage } from "@/components/staff/institution-setup";
export const Route = createFileRoute("/staff")({
  head: () => ({ meta: [{ title: "Staff — AttendAI" }] }),
  component: () => <InstitutionSetupPage section="staff" />,
});
