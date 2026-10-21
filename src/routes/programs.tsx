import { createFileRoute } from "@tanstack/react-router";
import { InstitutionSetupPage } from "@/components/staff/institution-setup";
export const Route = createFileRoute("/programs")({
  head: () => ({ meta: [{ title: "Programs and academic structure — AttendAI" }] }),
  component: () => <InstitutionSetupPage section="programs" />,
});
