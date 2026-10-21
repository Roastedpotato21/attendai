import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  Cloud,
  GraduationCap,
  Star,
  UsersRound,
} from "lucide-react";

const cards = [
  { icon: Cloud, color: "clay", left: -2, bottom: -12, tilt: -13 },
  { icon: BookOpen, color: "sand", left: 10, bottom: 8, tilt: 12 },
  { icon: Star, color: "taupe", left: 23, bottom: 122, tilt: -9 },
  { icon: CalendarCheck, color: "cocoa", left: 36, bottom: -8, tilt: 6 },
  { icon: ClipboardCheck, color: "ochre", left: 49, bottom: 102, tilt: -7 },
  { icon: GraduationCap, color: "paper", left: 62, bottom: -18, tilt: 11 },
  { icon: Star, color: "sand", left: 76, bottom: 108, tilt: 9 },
  { icon: UsersRound, color: "cocoa", left: 89, bottom: -14, tilt: -6 },
] as const;

/** Original implementation inspired by the public React Bits Pro 404-5 preview. */
export function NotFoundPage() {
  return (
    <>
      <div className="not-found-page">
        <a className="nf-skip" href="#not-found-content">
          Skip to content
        </a>
        <header className="nf-header">
          <Link to="/" className="nf-wordmark" aria-label="AttendAI home">
            AttendAI<span>.</span>
          </Link>
          <Link to="/dashboard" className="nf-workspace">
            Open your workspace <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </header>
        <main className="nf-main" id="not-found-content" tabIndex={-1}>
          <div className="nf-copy">
            <p className="nf-eyebrow">404 / Page not found</p>
            <h1>
              This page didn’t make
              <br />
              the roll call.
            </h1>
            <p className="nf-description">
              The link may have changed, or the address may be incorrect. <br />
              Let’s get you back to a familiar place.
            </p>
            <Link to="/" className="nf-home">
              Take me home <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <div className="nf-card-field" aria-hidden="true">
            {cards.map(({ icon: Icon, color, left, bottom, tilt }, index) => (
              <div
                key={index}
                className="nf-card-position"
                style={
                  {
                    "--card-left": `${left}%`,
                    "--card-bottom": `${bottom}px`,
                    "--card-tilt": `${tilt}deg`,
                    "--card-delay": `${index * 45}ms`,
                  } as CSSProperties
                }
              >
                <div className={`nf-card nf-card-${color}`}>
                  <Icon strokeWidth={1.8} />
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </>
  );
}
