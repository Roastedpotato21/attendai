import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";

export const Route = createFileRoute("/templates")({
  head: () => ({ meta: [{ title: "Templates — AttendAI" }] }),
  component: () => (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Templates"
        description="Custom message templates are not available yet. Attendance alerts use the configured server templates."
      />
    </div>
  ),
});
