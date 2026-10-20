import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";

export const Route = createFileRoute("/check-in")({
  head: () => ({ meta: [{ title: "Student check-in unavailable — AttendAI" }] }),
  component: () => (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Student check-in unavailable"
        description="Student self check-in is not enabled. Ask your teacher to record your attendance."
      />
    </div>
  ),
});
