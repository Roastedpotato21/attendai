import landingCss from "./welcome.css?url";

export const welcomeHead = () => ({
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
      crossOrigin: "anonymous" as const,
    },
    {
      rel: "preload",
      href: "/fonts/plus-jakarta-latin.woff2",
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous" as const,
    },
  ],
});
