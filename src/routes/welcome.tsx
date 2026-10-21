import { createFileRoute } from "@tanstack/react-router";
import { WelcomePage } from "@/components/landing/welcome-page";
import landingCss from "@/components/landing/welcome.css?url";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "AttendAI — Attendance, without the administrative noise" },
      {
        name: "description",
        content:
          "A considered workflow for institution setup, academic structure, staff, students, period attendance, guardian updates and accountable corrections.",
      },
      { property: "og:title", content: "AttendAI — A clearer institution day" },
      {
        property: "og:description",
        content: "Bring your people, attendance and guardian updates into one considered workflow.",
      },
    ],
    links: [
      { rel: "stylesheet", href: landingCss },
      {
        rel: "preload",
        href: "/fonts/inter-tight-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: "/fonts/plus-jakarta-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: WelcomePage,
});
