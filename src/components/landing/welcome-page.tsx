import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { ArrowDown, ArrowUpRight, Check, ChevronDown, Menu, X } from "lucide-react";
import { GlyphPortal } from "./glyph-portal";
import { AttendanceDevice, CircuitBoard } from "./fintech-visuals";
import { AnimatedGuide } from "./animated-guide";

const navigation = [
  ["Product", "product"],
  ["Solutions", "solutions"],
  ["Pricing", "pricing"],
  ["Docs", "docs"],
  ["Security", "security"],
  ["About", "about"],
] as const;
function Mark({ light = false }: { light?: boolean }) {
  return (
    <span className={"aw-mark" + (light ? " aw-mark-light" : "")} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="m5 19 7-15 7 15M8 13h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
function Action({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <a
      href={href}
      className={"aw-button " + (secondary ? "aw-button-secondary" : "aw-button-green")}
    >
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
  );
}
function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={"aw-reveal " + className} data-reveal>
      <span>{children}</span>
    </span>
  );
}

function Navigation() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <header className="aw-navigation" ref={ref}>
      <a href="#homepage" className="aw-wordmark">
        <Mark />
        AttendAI<span>.</span>
      </a>
      <nav className="aw-desktop-nav" aria-label="Main navigation">
        {navigation.map(([label, id]) => (
          <a key={id} href={"#" + id}>
            {label}
          </a>
        ))}
      </nav>
      <div className="aw-nav-actions">
        <a href="/login" className="aw-signin">
          Sign In <ArrowUpRight size={13} aria-hidden="true" />
        </a>
        <a className="aw-button aw-button-green aw-nav-start" href="/create-account">
          Get Started
        </a>
        <button
          className="aw-mobile-toggle"
          ref={button}
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="welcome-mobile-nav"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav
          id="welcome-mobile-nav"
          className="aw-mobile-nav"
          aria-label="Mobile navigation"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {navigation.map(([label, id], index) => (
            <a key={id} href={"#" + id}>
              <span>0{index + 1}</span>
              {label}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          ))}
          <a href="/login">
            <span>↗</span>Sign In
          </a>
          <a href="/create-account">
            <span>↗</span>Get Started
          </a>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="aw-hero" aria-labelledby="welcome-title">
      <CircuitBoard />
      <div className="aw-hero-copy">
        <p className="aw-eyebrow">
          <span className="aw-status-dot" />
          Built around your institution.
        </p>
        <h1 id="welcome-title">
          <Reveal>Attendance,</Reveal>
          <Reveal className="aw-soft-heading">without the</Reveal>
          <Reveal>administrative noise.</Reveal>
        </h1>
        <p className="aw-hero-description">
          From the first period to the last correction.
          <br className="aw-desktop-break" /> Bring your people, attendance and guardian updates
          into one considered workflow.
        </p>
        <div className="aw-actions">
          <Action href="/create-account">Get Started</Action>
          <Action href="#product" secondary>
            Explore Product
          </Action>
        </div>
        <p className="aw-hero-footnote">
          Verified institutions. Defined responsibilities. A clear record.
        </p>
      </div>
      <div className="aw-hero-bottom">
        <div className="aw-hero-note">
          <span className="aw-mono">/ THE EVERYDAY, CONNECTED /</span>
          <p>
            A little less chasing.
            <br />A lot more <span>clarity.</span>
          </p>
          <a href="#product" aria-label="Explore the AttendAI workflow">
            <ArrowDown size={20} />
          </a>
        </div>
        <div className="aw-device-wrap">
          <span className="aw-device-caption">
            <span className="aw-status-dot" />
            One connected workflow
          </span>
          <AttendanceDevice />
        </div>
        <div className="aw-preview-card">
          <span className="aw-card-kicker">PERIOD ATTENDANCE</span>
          <h2>
            Every period.
            <br />
            Its own clear record.
          </h2>
          <div className="aw-preview-states">
            <span>
              <i className="aw-dot-green" />
              Present
            </span>
            <span>
              <i className="aw-dot-ochre" />
              Absent
            </span>
            <span>
              <i />
              Approved Leave
            </span>
          </div>
          <div className="aw-preview-card-bottom">
            <Check size={13} />
            <span>No assumed attendance.</span>
            <span className="aw-mono">01 / 02</span>
          </div>
        </div>
        <div className="aw-preview-card aw-preview-card-alt">
          <span className="aw-card-kicker">RESPONSIBILITY & HISTORY</span>
          <h2>
            The right people.
            <br />
            The full context.
          </h2>
          <div className="aw-preview-lines">
            <span>
              Assigned faculty <Check size={12} />
            </span>
            <span>
              Reasoned corrections <Check size={12} />
            </span>
            <span>
              Guardian preferences <Check size={12} />
            </span>
          </div>
          <div className="aw-preview-card-bottom">
            <span>Roles stay in scope.</span>
            <span className="aw-mono">02 / 02</span>
          </div>
        </div>
      </div>
      <span className="aw-visual-caption">
        Product workflow illustration · no student records shown
      </span>
    </section>
  );
}

const capabilities = [
  {
    id: "institution",
    number: "01",
    title: "Institution Setup",
    text: "Begin with reviewed institution verification. Build a workspace with a recognised identity and an authorised owner.",
    labels: ["Verified identity", "Institution profile", "Owner & admins"],
  },
  {
    id: "academics",
    number: "02",
    title: "Academic Structure",
    text: "Your departments, programs, terms, sections and subjects. Structure that follows your institution, rather than a fixed template.",
    labels: ["Departments", "Programs & terms", "Sections & subjects"],
  },
  {
    id: "staff",
    number: "03",
    title: "Staff & Faculty",
    text: "Separate designations from permissions. Give people the roles and dated responsibilities their work actually needs.",
    labels: ["Faculty", "Class Incharge", "HOD & Coordinator"],
  },
  {
    id: "students",
    number: "04",
    title: "Student Management",
    text: "Import reviewed student data. Follow cohorts, placements and academic moves while keeping the same student identity.",
    labels: ["Reviewed imports", "Cohorts", "Placement history"],
  },
];
function Product() {
  return (
    <section className="aw-product aw-section" id="product" aria-labelledby="product-title">
      <div className="aw-section-heading">
        <p className="aw-kicker">THE FOUNDATION</p>
        <h2 id="product-title">
          <Reveal>A place for everything.</Reveal>
          <Reveal className="aw-muted-cream">A role for everyone.</Reveal>
        </h2>
        <p>
          Set things up with intention.
          <br />
          Let the day run with a little more ease.
        </p>
      </div>
      <div className="aw-capability-grid">
        {capabilities.map((item) => (
          <article className="aw-capability" id={item.id} key={item.id} data-reveal>
            <div className="aw-capability-top">
              <span className="aw-mono">{item.number}</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </div>
            <div className={"aw-capability-visual aw-visual-" + item.id} aria-hidden="true">
              {item.labels.map((label, index) => (
                <span key={label} style={{ "--stack": index } as CSSProperties}>
                  <i>{index === 0 ? <Check size={13} /> : <span />}</i>
                  {label}
                </span>
              ))}
            </div>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Attendance() {
  return (
    <section
      className="aw-attendance aw-section"
      id="attendance"
      aria-labelledby="attendance-title"
    >
      <div className="aw-section-heading">
        <p className="aw-kicker">THE DAY, PERIOD BY PERIOD</p>
        <h2 id="attendance-title">
          <Reveal>More than a tick.</Reveal>
          <Reveal className="aw-muted-cream">A record you can follow.</Reveal>
        </h2>
        <p>
          Timetables, assigned faculty, deliberate submission.
          <br />
          Every step has its place.
        </p>
      </div>
      <div className="aw-attendance-panel">
        <div className="aw-session-preview" data-reveal>
          <div className="aw-panel-label">
            <span>ATTENDANCE WORKFLOW</span>
            <span className="aw-mono">PERIOD / SESSION</span>
          </div>
          <div className="aw-session-title">
            <Mark />
            <div>
              <h3>From scheduled to settled.</h3>
              <p>One subject. One period. One accountable record.</p>
            </div>
          </div>
          <ol className="aw-session-steps">
            {[
              ["01", "Scheduled", "An actual timetable and assigned faculty."],
              ["02", "Mark & review", "Present, Absent or recorded Approved Leave."],
              ["03", "Final Submit", "Every student marked. A deliberate confirmation."],
              ["04", "Grace period", "Five minutes for the submitter to correct a mistake."],
              ["05", "Locked", "Later corrections belong to the student's Class Incharge."],
            ].map(([n, title, text]) => (
              <li key={n}>
                <span>{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
                <Check size={14} aria-hidden="true" />
              </li>
            ))}
          </ol>
          <span className="aw-preview-note">
            A workflow preview, never a live student register.
          </span>
        </div>
        <div className="aw-attendance-aside">
          <p className="aw-kicker">PERIOD ATTENDANCE</p>
          <h3>
            Nothing marked
            <br />
            by assumption.
          </h3>
          <p>
            A pending session stays pending. A cancelled class stays cancelled. Labs and combined
            periods keep one logical session, with the right roster and teaching responsibility.
          </p>
          <a className="aw-text-link" href="#docs">
            Understand the workflow <ArrowUpRight size={17} />
          </a>
          <div className="aw-aside-note">
            <span className="aw-mono">DESIGNED FOR THE REAL DAY</span>
            <p>
              Normal periods. Labs. Merged sections.
              <br />
              Extra classes. Session substitutes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Communication() {
  return (
    <section
      className="aw-communication aw-section"
      id="guardians"
      aria-labelledby="guardian-title"
    >
      <div className="aw-section-heading">
        <p className="aw-kicker">THE PEOPLE BEYOND THE CLASSROOM</p>
        <h2 id="guardian-title">
          <Reveal>Keep guardians informed.</Reveal>
          <Reveal className="aw-muted-cream">Keep the context intact.</Reveal>
        </h2>
        <p>
          Thoughtful notifications, considered corrections.
          <br />A clear trail from the original record to the update.
        </p>
      </div>
      <div className="aw-communication-grid">
        <article data-reveal>
          <div className="aw-notification-visual">
            <span className="aw-mono">THE NOTIFICATION PATH</span>
            <div className="aw-notice-path">
              <span>Locked absence</span>
              <i>↓</i>
              <span>Relationship & consent</span>
              <i>↓</i>
              <span className="aw-path-active">
                Guardian alert <ArrowUpRight size={14} />
              </span>
            </div>
            <p>
              First eligible absence alert per day.
              <br />
              Remaining absences in a daily summary.
            </p>
          </div>
          <h3>Guardian Notifications</h3>
          <p>
            Multiple guardians, independent preferences and current contact details. Alerts depend
            on eligibility, consent and an available delivery registration.
          </p>
          <span className="aw-small-note">
            Provider acceptance and device acknowledgment are recorded separately.
          </span>
        </article>
        <article data-reveal id="corrections">
          <div className="aw-correction-visual">
            <span className="aw-mono">A CHANGE WITH CONTEXT</span>
            <div className="aw-correction-mark">
              <span>Original mark</span>
              <strong>Retained</strong>
            </div>
            <div className="aw-correction-bridge">
              <span />↓<span />
            </div>
            <div className="aw-correction-mark aw-mark-current">
              <span>Permitted correction</span>
              <strong>
                Reason recorded <Check size={13} />
              </strong>
            </div>
            <p>Original → change → accountable history.</p>
          </div>
          <h3>Attendance Corrections</h3>
          <p>
            Correct a mistake without erasing the original record. Unsent stale notices are
            cancelled; provider-accepted notices can receive a separate correction.
          </p>
          <span className="aw-small-note">No silent edits. No lost context.</span>
        </article>
      </div>
    </section>
  );
}

function Solutions() {
  return (
    <section className="aw-solutions aw-section" id="solutions" aria-labelledby="solutions-title">
      <div>
        <p className="aw-kicker">ONE INSTITUTION. DIFFERENT PERSPECTIVES.</p>
        <h2 id="solutions-title">
          <Reveal>Built for the people</Reveal>
          <Reveal className="aw-soft-heading">who make the day work.</Reveal>
        </h2>
      </div>
      <div className="aw-solution-rows">
        {[
          [
            "Institution leaders",
            "A recognised workspace, clear ownership and accountable administration.",
          ],
          [
            "Faculty & Class Incharge",
            "Assigned sessions, defined correction authority and less ambiguity.",
          ],
          [
            "Academic teams",
            "A shared structure for departments, programs, cohorts and student movement.",
          ],
        ].map(([title, text], index) => (
          <article data-reveal key={title}>
            <span className="aw-mono">0{index + 1}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
            <ArrowUpRight size={20} aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  );
}

const guides = [
  {
    question: "How does an institution get started?",
    answer:
      "Create an account, verify your email and submit your institution and representative evidence for review. Account verification alone does not grant institution access. Once approved, the owner can configure the institution and academic structure.",
    href: "/create-account",
    label: "Start an institution application",
  },
  {
    question: "Who can mark and correct attendance?",
    answer:
      "The assigned subject faculty member, or a valid session substitute, marks the session. Final Submit opens a five-minute correction window for that submitter. After lock, the current Class Incharge can correct students in their own section with a recorded reason.",
    href: "#attendance",
    label: "Explore period attendance",
  },
  {
    question: "How do guardian alerts work?",
    answer:
      "Alerts use a current guardian relationship, notification preferences, consent and an eligible delivery registration. The first eligible locked absence can generate an alert; other final absences appear in the daily summary. A provider-accepted request is not proof that a device displayed the notice.",
    href: "#guardians",
    label: "Explore guardian notifications",
  },
  {
    question: "What happens when a student changes program or section?",
    answer:
      "The student keeps the same identity. A dated placement transition records the new academic scope and retains the previous placement history. Reviewed promotion and status changes are explicit operations, rather than automatic guesses from a cohort name.",
    href: "#students",
    label: "Explore student management",
  },
];
function Guides() {
  return (
    <section className="aw-guides aw-section" id="docs" aria-labelledby="docs-title">
      <div>
        <p className="aw-kicker">DOCS & GUIDES</p>
        <h2 id="docs-title">
          <Reveal>A clearer start.</Reveal>
          <Reveal className="aw-soft-heading">A little less guesswork.</Reveal>
        </h2>
        <p>The essentials, before you step inside.</p>
      </div>
      <div className="aw-faq">
        {guides.map((guide, index) => (
          <AnimatedGuide
            key={guide.question}
            question={
              <>
                <span className="aw-mono">0{index + 1}</span>
                {guide.question}
                <ChevronDown size={18} aria-hidden="true" />
              </>
            }
          >
            <p>{guide.answer}</p>
            <a className="aw-text-link" href={guide.href}>
              {guide.label}
              <ArrowUpRight size={15} />
            </a>
          </AnimatedGuide>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  const columns = [
    {
      title: "PRODUCT",
      links: [
        ["Features", "#product"],
        ["Attendance", "#attendance"],
        ["Guardian Alerts", "#guardians"],
        ["Security", "#security"],
      ],
    },
    {
      title: "RESOURCES",
      links: [
        ["Docs", "#docs"],
        ["Guides", "#docs"],
        ["Help", "#contact"],
      ],
    },
    {
      title: "COMPANY",
      links: [
        ["About", "#about"],
        ["Contact", "#contact"],
        ["Pricing", "#pricing"],
      ],
    },
    {
      title: "LEGAL",
      links: [
        ["Privacy", "/privacy"],
        ["Terms", "/terms"],
      ],
    },
  ];
  return (
    <footer className="aw-footer">
      <div className="aw-footer-top">
        <div className="aw-footer-brand">
          <a href="#homepage" className="aw-wordmark">
            <Mark light />
            AttendAI<span>.</span>
          </a>
          <p>
            Attendance, with clarity.
            <br />
            For the people behind every institution day.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title + " footer"}>
            <h2>{column.title}</h2>
            <ul>
              {column.links.map(([label, href]) => (
                <li key={label}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="aw-footer-wordmark" aria-hidden="true">
        AttendAI<span>.</span>
      </div>
      <div className="aw-footer-bottom">
        <span>© {new Date().getFullYear()} AttendAI</span>
        <span>A more considered institution day.</span>
        <a href="#homepage">Back to top ↑</a>
      </div>
    </footer>
  );
}

export function WelcomePage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;
    function setup() {
      observer?.disconnect();
      root!.classList.toggle("aw-motion", !media.matches);
      if (media.matches) return;
      // Observe an unclipped box: a fully masked card has zero intersection area.
      const reveals = new Map<Element, HTMLElement[]>();
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              reveals.get(entry.target)?.forEach((element) => element.classList.add("aw-revealed"));
              observer?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -24px 0px" },
      );
      root!.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
        if (
          element.getBoundingClientRect().top < innerHeight &&
          element.getBoundingClientRect().bottom > 0
        )
          element.classList.add("aw-revealed");
        else {
          const trigger = element.classList.contains("aw-reveal")
            ? element
            : element.parentElement!;
          reveals.set(trigger, [...(reveals.get(trigger) ?? []), element]);
          observer?.observe(trigger);
        }
      });
    }
    setup();
    media.addEventListener("change", setup);
    const onAnchor = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = document.getElementById(anchor.hash.slice(1));
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: media.matches ? "instant" : "smooth", block: "start" });
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    };
    root.addEventListener("click", onAnchor);
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", setup);
      root.removeEventListener("click", onAnchor);
    };
  }, []);
  return (
    <div className="attend-landing" ref={ref}>
      <a className="aw-skip" href="#main-content">
        Skip to content
      </a>
      <GlyphPortal
        background={
          <div className="aw-portal-landscape">
            <CircuitBoard dark />
          </div>
        }
      >
        <Navigation />
        <main id="main-content" tabIndex={-1}>
          <Hero />
          <section className="aw-about aw-section" id="about" aria-labelledby="about-title">
            <p className="aw-kicker">LESS FRICTION. MORE FOCUS.</p>
            <h2 id="about-title">
              <Reveal>Institution life has enough moving parts.</Reveal>
              <Reveal className="aw-muted-cream">Attendance shouldn't add to them.</Reveal>
            </h2>
            <div className="aw-about-bottom">
              <span className="aw-mono">A CONNECTED WAY TO WORK</span>
              <p>
                AttendAI brings institution setup, academic structure, people and period attendance
                into a shared workflow. With clear responsibilities, considered guardian updates and
                a history that stays intact.
              </p>
            </div>
          </section>
          <Product />
          <Attendance />
          <Communication />
          <Solutions />
          <section
            className="aw-security aw-section"
            id="security"
            aria-labelledby="security-title"
          >
            <div>
              <p className="aw-kicker">SECURITY & AUDIT</p>
              <h2 id="security-title">
                <Reveal>Trust belongs</Reveal>
                <Reveal className="aw-muted-cream">in the details.</Reveal>
              </h2>
              <p>
                Verified institutional access. Responsibilities within their scope. A record of
                consequential changes.
              </p>
              <a className="aw-text-link" href="/privacy">
                Read our privacy notice
                <ArrowUpRight size={17} />
              </a>
            </div>
            <ul>
              {[
                [
                  "Reviewed onboarding",
                  "Institution identity and representative authority are reviewed before access is approved.",
                ],
                [
                  "Scoped responsibilities",
                  "Permissions follow the institution, assigned role, academic scope and effective dates.",
                ],
                [
                  "Accountable changes",
                  "Submissions, corrections and lifecycle changes retain their actor, reason and history.",
                ],
              ].map(([title, body]) => (
                <li key={title} data-reveal>
                  <Check size={18} aria-hidden="true" />
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <Guides />
          <section className="aw-pricing aw-section" id="pricing" aria-labelledby="pricing-title">
            <div>
              <p className="aw-kicker">PRICING</p>
              <h2 id="pricing-title">
                <Reveal>Made for your institution.</Reveal>
                <Reveal className="aw-soft-heading">Without the guesswork.</Reveal>
              </h2>
            </div>
            <div className="aw-pricing-detail">
              <span className="aw-pill">DETAILS COMING SOON</span>
              <p>
                Commercial plans and pricing have not been published yet. Start with the institution
                application to understand the onboarding process.
              </p>
              <Action href="/create-account">Get Started</Action>
              <small>Applications are reviewed. Signing up does not guarantee approval.</small>
            </div>
          </section>
          <section className="aw-final-cta aw-section" id="contact" aria-labelledby="contact-title">
            <Mark light />
            <p className="aw-kicker">THE NEXT INSTITUTION DAY</p>
            <h2 id="contact-title">
              <Reveal>Less noise.</Reveal>
              <Reveal className="aw-muted-cream">More room for what matters.</Reveal>
            </h2>
            <p>Bring your institution's people and daily attendance into focus.</p>
            <div className="aw-actions">
              <Action href="/create-account">Get Started</Action>
              <Action href="/login" secondary>
                Sign In
              </Action>
            </div>
            <span className="aw-small-note">
              Getting started? <a href="#docs">Read the onboarding guide.</a> Already have an
              account? Use the existing sign-in flow.
            </span>
          </section>
        </main>
        <Footer />
      </GlyphPortal>
    </div>
  );
}
