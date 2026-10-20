import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";

export const Route = createFileRoute("/insights")({
  head: () => ({ meta: [{ title: "Insights — AttendAI" }] }),
  component: () => (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Insights"
        description="No published insights are available. View Analytics for attendance calculated from your institution records."
      />
    </div>
  ),
});
