import { createFileRoute } from "@tanstack/react-router";
import { AcademicStudentsPage } from "@/components/students/academic-students";
export const Route = createFileRoute("/students")({
  head: () => ({ meta: [{ title: "Students — AttendAI" }] }),
  component: () => <AcademicStudentsPage page="directory" />,
});
