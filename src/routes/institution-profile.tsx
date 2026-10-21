import { createFileRoute } from "@tanstack/react-router";
import { InstitutionSetupPage } from "@/components/staff/institution-setup";
export const Route = createFileRoute("/institution-profile")({
  head: () => ({ meta: [{ title: "Institution profile — AttendAI" }] }),
  component: () => <InstitutionSetupPage section="profile" />,
});
