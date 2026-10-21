import { createFileRoute } from "@tanstack/react-router";
import { PeriodWorkspace } from "@/components/attendance/period-workspace";
export const Route = createFileRoute("/timetable")({
  component: () => <PeriodWorkspace page="timetable" />,
});
