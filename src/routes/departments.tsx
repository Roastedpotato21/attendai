import { createFileRoute } from "@tanstack/react-router";
import { InstitutionSetupPage } from "@/components/staff/institution-setup";
export const Route = createFileRoute("/departments")({
  head: () => ({ meta: [{ title: "Departments — AttendAI" }] }),
  component: () => <InstitutionSetupPage section="departments" />,
});
