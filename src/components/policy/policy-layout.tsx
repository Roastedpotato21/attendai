import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function PolicyLayout({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-10 text-foreground">
      <article className="mx-auto max-w-3xl rounded-xl border bg-background p-6 shadow-sm sm:p-10">
        <Link
          to="/login"
          search={{ redirect: undefined }}
          className="text-sm font-semibold text-primary"
        >
          AttendAI
        </Link>
        <h1 className="mt-5 font-display text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Version {version} · Effective 15 October 2026
        </p>
        <div className="mt-8 space-y-7 leading-7 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
        <nav className="mt-10 flex gap-5 border-t pt-5 text-sm text-primary">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms & Conditions</Link>
        </nav>
      </article>
    </main>
  );
}
