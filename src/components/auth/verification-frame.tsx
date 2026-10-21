import type { ReactNode } from "react";
export function VerificationFrame({ children }: { children: ReactNode }) {
  return (
    <div className="attend-landing aw-verification">
      <a className="aw-skip" href="#verification-content">
        Skip to verification
      </a>
      <header className="aw-auth-header">
        <a href="/" className="aw-wordmark">
          <span className="aw-auth-mark" aria-hidden="true">
            A
          </span>
          AttendAI<span>.</span>
        </a>
        <nav aria-label="Verification navigation">
          <a href="/">Back to home ↗</a>
          <a href="/login">Sign In ↗</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
