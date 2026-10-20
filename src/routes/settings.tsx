import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — AttendAI" }] }),
  component: () => (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Settings"
        description="Institution settings are not available for editing here yet. Contact your institution administrator."
      />
    </div>
  ),
});
