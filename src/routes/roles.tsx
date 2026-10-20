import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/common/page-parts";
import { routeAuth } from "@/lib/route-auth";

export const Route = createFileRoute("/roles")({ component: RolesPage });
function RolesPage() {
  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Roles & Permissions"
        description="Portal route access. Database permissions are enforced separately by your institution's access rules."
      />
      <table className="w-full text-left">
        <thead>
          <tr>
            <th>Page</th>
            <th>Allowed roles</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(routeAuth)
            .filter(([, rule]) => !rule.public)
            .map(([path, rule]) => (
              <tr key={path}>
                <td>{path}</td>
                <td>{rule.allowedRoles?.join(", ") ?? "Authenticated staff"}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
