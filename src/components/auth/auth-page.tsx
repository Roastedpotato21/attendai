import type { ReactNode } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { CircuitBoard } from "@/components/landing/fintech-visuals";
import { welcomeHead } from "@/components/landing/page-head";
import authCss from "./auth-page.css?url";
import codeSlotsCss from "./code-slots/code-slots.css?url";

export function authPageHead(title: string, description: string) {
  return {
    meta: [{ title: title + " — AttendAI" }, { name: "description", content: description }],
    links: [
      ...welcomeHead().links,
      { rel: "stylesheet", href: authCss },
      { rel: "stylesheet", href: codeSlotsCss },
    ],
  };
}

export function AuthPage({ children, signup = false }: { children: ReactNode; signup?: boolean }) {
  return (
    <div className={"attend-landing aw-auth" + (signup ? " aw-auth-signup" : "")}>
      <a className="aw-skip" href="#auth-content">
        Skip to form
      </a>
      <header className="aw-auth-header">
        <a href="/" className="aw-wordmark" aria-label="AttendAI home">
          <span className="aw-auth-mark" aria-hidden="true">
            A
          </span>
          AttendAI<span>.</span>
        </a>
        <nav aria-label="Account navigation">
          <a href="/" className="aw-auth-home">
            Back to home <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <a href={signup ? "/login" : "/create-account"} className="aw-button aw-button-green">
            {signup ? "Sign In" : "Get Started"}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </nav>
      </header>
      <main className="aw-auth-main" id="auth-content" tabIndex={-1}>
        <aside className="aw-auth-story" aria-label="The AttendAI workflow">
          <CircuitBoard dark />
          <div className="aw-auth-story-copy">
            <p className="aw-kicker">
              {signup ? "A CONSIDERED START" : "A CLEARER INSTITUTION DAY"}
            </p>
            <h2>
              {signup ? (
                <>
                  Your institution.
                  <br />
                  <span>Your next chapter.</span>
                </>
              ) : (
                <>
                  Less noise.
                  <br />
                  <span>More clarity.</span>
                </>
              )}
            </h2>
            <p>
              {signup
                ? "Start with your institution's identity. Build a shared workflow for the people and responsibilities behind every day."
                : "Your people, periods and responsibilities. Pick up where the institution day left off."}
            </p>
          </div>
          <div className="aw-auth-workflow">
            <span className="aw-mono">
              {signup ? "FROM APPLICATION TO WORKSPACE" : "ONE CONNECTED WORKFLOW"}
            </span>
            {(signup
              ? [
                  "Find your institution",
                  "Create your applicant account",
                  "Complete independent verification",
                ]
              : ["Defined responsibilities", "Period-wise attendance", "Accountable corrections"]
            ).map((label, index) => (
              <div key={label}>
                <span className="aw-mono">0{index + 1}</span>
                <span>{label}</span>
                <Check size={14} aria-hidden="true" />
              </div>
            ))}
            <p>
              {signup
                ? "An account establishes identity. Institution access follows approval."
                : "Access follows your verified account and current institutional role."}
            </p>
          </div>
          <span className="aw-auth-story-brand" aria-hidden="true">
            AttendAI.
          </span>
        </aside>
        <section className="aw-auth-panel" aria-labelledby="auth-title">
          {children}
        </section>
      </main>
      <footer className="aw-auth-footer">
        <span>A more considered institution day.</span>
        <nav aria-label="Legal">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
