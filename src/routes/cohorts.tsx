import { createFileRoute } from "@tanstack/react-router";
import { AcademicStudentsPage } from "@/components/students/academic-students";
export const Route = createFileRoute("/cohorts")({
  head: () => ({ meta: [{ title: "Batches / Cohorts — AttendAI" }] }),
  component: () => <AcademicStudentsPage page="cohorts" />,
});
