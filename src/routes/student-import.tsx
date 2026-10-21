import { createFileRoute } from "@tanstack/react-router";
import { AcademicStudentsPage } from "@/components/students/academic-students";
export const Route = createFileRoute("/student-import")({
  head: () => ({ meta: [{ title: "Student Import — AttendAI" }] }),
  component: () => <AcademicStudentsPage page="import" />,
});
