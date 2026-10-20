import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";

export const Route = createFileRoute("/integrations")({
  head: () => ({ meta: [{ title: "Integrations — AttendAI" }] }),
  component: () => (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Integrations"
        description="Integration status is not available in this dashboard yet. Contact your institution administrator to manage notification providers."
      />
    </div>
  ),
});
