import { createFileRoute } from "@tanstack/react-router";
import { AcademicStudentsPage } from "@/components/students/academic-students";
export const Route = createFileRoute("/student-promotion")({
  head: () => ({ meta: [{ title: "Student Promotion — AttendAI" }] }),
  component: () => <AcademicStudentsPage page="promotion" />,
});
