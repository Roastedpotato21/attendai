import { createFileRoute, Link } from "@tanstack/react-router";
export const Route = createFileRoute("/faculty")({
  component: () => (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Staff and academic responsibilities</h1>
      <p>
        Manage staff identities, designations, roles and academic assignments in Institution Setup.
      </p>
      <Link to="/staff" className="underline">
        Open staff directory
      </Link>
      {" · "}
      <Link to="/staff-assignments" className="underline">
        Roles & assignments
      </Link>
    </main>
  ),
});
