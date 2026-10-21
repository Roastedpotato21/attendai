import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { CircuitBoard } from "@/components/landing/fintech-visuals";
import { authPageHead } from "@/components/auth/auth-page";
import policyCss from "./policy-page.css?url";

export function policyPageHead(title: string) {
  const head = authPageHead(
    title,
    "AttendAI policies for institution accounts, attendance records and guardian communication.",
  );
  return { ...head, links: [...head.links, { rel: "stylesheet", href: policyCss }] };
}

export function PolicyLayout({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;
    function setup() {
      observer?.disconnect();
      root!.classList.toggle("aw-policy-motion", !media.matches);
      if (media.matches) return;
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("aw-policy-visible");
              observer?.unobserve(entry.target);
            }
          }),
        { threshold: 0.05 },
      );
      root!
        .querySelectorAll(".aw-policy-body > section")
        .forEach((section) => observer!.observe(section));
    }
    setup();
    media.addEventListener("change", setup);
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", setup);
    };
  }, []);
  return (
    <div className="attend-landing aw-policy" ref={ref}>
      <a className="aw-skip" href="#policy-content">
        Skip to policy
      </a>
      <header className="aw-auth-header">
        <Link to="/" className="aw-wordmark">
          <span className="aw-auth-mark" aria-hidden="true">
            A
          </span>
          AttendAI<span>.</span>
        </Link>
        <nav aria-label="Account navigation">
          <Link to="/">Back to home</Link>
          <a className="aw-button aw-button-green" href="/login">
            Sign In ↗
          </a>
        </nav>
      </header>
      <main id="policy-content" tabIndex={-1}>
        <div className="aw-policy-hero">
          <CircuitBoard dark />
          <div>
            <p className="aw-kicker">TRUST, IN THE DETAILS</p>
            <h1>
              <span>{title}</span>
            </h1>
            <p className="aw-policy-version">Version {version} · Effective 15 October 2026</p>
          </div>
          <p className="aw-policy-draft">
            Product draft pending final institutional and legal review.
          </p>
        </div>
        <article className="aw-policy-body">{children}</article>
      </main>
      <footer className="aw-policy-footer">
        <span>A more considered institution day.</span>
        <nav aria-label="Policy navigation">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms & Conditions</Link>
          <Link to="/">Home</Link>
        </nav>
      </footer>
    </div>
  );
}
