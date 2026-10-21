/** Glyph Portal, adapted from Christian Katzmann's MIT-licensed public demo.
 * Retains its measured glyph interior, camera interpolation, rotation and native scroll.
 * No renderer or animation dependency. See docs/landing-page-references.md.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const smooth = (a: number, b: number, value: number) => {
  const n = clamp((value - a) / (b - a));
  return n * n * (3 - 2 * n);
};
type Interior = { x: number; y: number; radius: number; index: number };
// Original largest-inscribed-square scan. Only fully opaque glyph ink can be a portal.
function interior(context: CanvasRenderingContext2D, glyph: string, font: string) {
  const canvas = context.canvas;
  context.font = font;
  const metrics = context.measureText(glyph),
    padding = 8;
  const left = Math.ceil(metrics.actualBoundingBoxLeft),
    ascent = Math.ceil(metrics.actualBoundingBoxAscent);
  canvas.width = Math.max(
    1,
    Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + padding * 2,
  );
  canvas.height = Math.max(
    1,
    Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + padding * 2,
  );
  context.font = font;
  context.fontKerning = "none";
  context.fillText(glyph, padding + left, padding + ascent);
  const { width, height } = canvas,
    pixels = context.getImageData(0, 0, width, height).data;
  const previous = new Uint16Array(width + 1);
  let largest = 0,
    right = 0,
    bottom = 0;
  for (let y = 0; y < height; y++) {
    let diagonal = 0;
    for (let x = 0; x < width; x++) {
      const before = previous[x + 1] ?? 0;
      previous[x + 1] =
        (pixels[(y * width + x) * 4 + 3] ?? 0) > 245
          ? Math.min(before, previous[x] ?? 0, diagonal) + 1
          : 0;
      diagonal = before;
      if ((previous[x + 1] ?? 0) > largest) {
        largest = previous[x + 1] ?? 0;
        right = x;
        bottom = y;
      }
    }
  }
  return largest < 3
    ? null
    : {
        x: (right + 1 - largest / 2 - padding - left) / 3,
        y: (bottom + 1 - largest / 2 - padding - ascent) / 3,
        radius: (largest / 2 - 1) / 3,
      };
}

export function GlyphPortal({
  children,
  background,
}: {
  children: ReactNode;
  background: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const clip = "attend-glyph-" + useId().replaceAll(":", "");
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const field = root.querySelector<HTMLElement>("[data-portal-field]")!;
    const svg = root.querySelector<SVGSVGElement>("[data-portal-art]")!;
    const clipNode = root.querySelector<SVGClipPathElement>("clipPath")!;
    const text = root.querySelector<SVGTextElement>("[data-portal-art] text")!;
    const front = root.querySelector<HTMLElement>(".aw-portal-front")!;
    const pin = root.querySelector<HTMLElement>("[data-portal-pin]")!;
    const choices = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-portal-letter]"));
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    let disposed = false,
      frame = 0,
      visible = true,
      measured = false,
      last = -1;
    let width = 1,
      height = 1,
      base = 1,
      target = 1,
      wordCenter = { x: 0, y: 0 };
    let focus: Interior | undefined;
    const points: Interior[] = [];
    let wordWidth = 0,
      wordHeight = 0;
    const letterBounds: { left: number; top: number; width: number; height: number }[] = [];
    const word = "AttendAI",
      family = '"Attend Portal", Arial, sans-serif';
    function paint() {
      frame = 0;
      if (disposed || !visible || !measured) return;
      const progress = media.matches
        ? 0
        : clamp(-root!.getBoundingClientRect().top / (height * 2.4));
      if (progress === last) return;
      last = progress;
      const segment = clamp(progress / 0.78);
      const eased = segment < 0.5 ? 4 * segment ** 3 : 1 - (-2 * segment + 2) ** 3 / 2;
      const scale = Math.exp(Math.log(base) + Math.log(target / base) * eased);
      const camera = target === base ? 0 : (1 / scale - 1 / base) / (1 / target - 1 / base);
      const x = wordCenter.x + ((focus?.x ?? wordCenter.x) - wordCenter.x) * camera;
      const y = wordCenter.y + ((focus?.y ?? wordCenter.y) - wordCenter.y) * camera;
      const rotation = -4 * smooth(0.06, 0.5, segment) * (1 - smooth(0.62, 0.92, segment));
      const radians = (rotation * Math.PI) / 180,
        offsetX = width / 2 / scale,
        offsetY = (height * 0.46 + height * 0.04 * eased) / scale;
      clipNode.setAttribute("transform", `scale(${scale}) rotate(${rotation})`);
      text.setAttribute(
        "transform",
        `translate(${Math.cos(radians) * offsetX + Math.sin(radians) * offsetY - x} ${-Math.sin(radians) * offsetX + Math.cos(radians) * offsetY - y})`,
      );
      field.style.clipPath = segment >= 1 ? "none" : `url(#${clip})`;
      root!.style.setProperty("--portal-caption", String(1 - smooth(0.01, 0.16, progress)));
      root!.dataset["portalChoosing"] = String(!media.matches && progress < 0.04);
      root!.dataset["portalEntered"] = String(media.matches || progress >= 0.9);
      root!.dataset["portalProgress"] = progress.toFixed(5);
      front.inert = progress >= 0.16;
      choices.forEach((button) => {
        button.inert = progress >= 0.04 || media.matches;
      });
    }
    const schedule = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(paint);
    };
    function choose(index: number) {
      focus = points.find((point) => point.index === index) ?? focus;
      target = focus ? Math.max(base, Math.hypot(width, height) / (focus.radius * 1.35)) : base;
      root!.dataset["portalFocus"] = String(focus?.index ?? 0);
      choices.forEach((button) => {
        const selected = Number(button.dataset["portalLetter"]) === focus?.index;
        button.setAttribute("aria-checked", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      last = -1;
      schedule();
    }
    function layout() {
      if (disposed || !context) return;
      width = pin.clientWidth;
      height = window.innerHeight;
      root!.style.setProperty("--portal-height", `${height}px`);
      root!.dataset["portalMotion"] = media.matches ? "off" : "on";
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      if (!wordWidth) {
        const font = `700 100px ${family}`;
        context.font = font;
        context.fontKerning = "none";
        const metric = context.measureText(word);
        wordWidth = metric.actualBoundingBoxLeft + metric.actualBoundingBoxRight;
        wordHeight = metric.actualBoundingBoxAscent + metric.actualBoundingBoxDescent;
        if (!wordWidth || !wordHeight) return;
        wordCenter = {
          x: -metric.actualBoundingBoxLeft + wordWidth / 2,
          y: -metric.actualBoundingBoxAscent + wordHeight / 2,
        };
        for (let index = 0; index < word.length; index++) {
          context.font = font;
          context.fontKerning = "none";
          const prefix = context.measureText(word.slice(0, index)).width,
            glyph = word[index]!;
          const glyphMetric = context.measureText(glyph);
          const point = interior(context, glyph, `700 300px ${family}`);
          if (point) points.push({ ...point, x: point.x + prefix, index });
          letterBounds.push({
            left: prefix - glyphMetric.actualBoundingBoxLeft,
            top: -glyphMetric.actualBoundingBoxAscent,
            width: glyphMetric.actualBoundingBoxLeft + glyphMetric.actualBoundingBoxRight,
            height: glyphMetric.actualBoundingBoxAscent + glyphMetric.actualBoundingBoxDescent,
          });
        }
      }
      base = Math.min((width * 0.86) / wordWidth, (height * 0.38) / wordHeight);
      letterBounds.forEach((bounds, index) => {
        const button = choices[index];
        if (button)
          Object.assign(button.style, {
            left: `${width / 2 + (bounds.left - wordCenter.x) * base}px`,
            top: `${height * 0.46 + (bounds.top - wordCenter.y) * base}px`,
            width: `${Math.max(1, bounds.width * base)}px`,
            height: `${Math.max(44, bounds.height * base)}px`,
          });
      });
      measured = true;
      root!.style.setProperty("--portal-word-top", `${height * 0.46 - (wordHeight * base) / 2}px`);
      root!.style.setProperty(
        "--portal-word-bottom",
        `${height * 0.46 + (wordHeight * base) / 2}px`,
      );
      root!.dataset["portalReady"] = "true";
      choose(focus?.index ?? 0);
    }
    const onPick = (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-portal-letter]",
      );
      if (button && Number(root!.dataset["portalProgress"] ?? 0) < 0.04)
        choose(Number(button.dataset["portalLetter"]));
    };
    const onKey = (event: KeyboardEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-portal-letter]",
      );
      if (
        !button ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
      )
        return;
      event.preventDefault();
      const index = choices.indexOf(button);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? choices.length - 1
            : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + choices.length) %
              choices.length;
      choices[next]?.focus({ preventScroll: true });
    };
    const ready = async () => {
      try {
        await Promise.race([
          document.fonts.load(`700 100px ${family}`),
          new Promise((resolve) => setTimeout(resolve, 1800)),
        ]);
      } catch {
        /* Native fallback remains readable. */
      }
      if (!disposed) layout();
    };
    void ready();
    const resize = new ResizeObserver(() => {
      if (measured) layout();
    });
    resize.observe(pin);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) {
          last = -1;
          schedule();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(root);
    root.addEventListener("pointerover", onPick);
    root.addEventListener("focusin", onPick);
    root.addEventListener("click", onPick);
    root.addEventListener("keydown", onKey);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", layout);
    media.addEventListener("change", layout);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      root.removeEventListener("pointerover", onPick);
      root.removeEventListener("focusin", onPick);
      root.removeEventListener("click", onPick);
      root.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", layout);
      media.removeEventListener("change", layout);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [clip]);
  return (
    <section className="aw-portal" ref={ref} aria-label="AttendAI opening">
      <div data-portal-pin>
        <div data-portal-field aria-hidden="true" inert>
          {background}
        </div>
        <svg data-portal-art aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clip} clipPathUnits="userSpaceOnUse">
              <text
                x="0"
                y="0"
                style={{
                  fontFamily: '"Attend Portal", Arial, sans-serif',
                  fontWeight: 700,
                  fontSize: 100,
                  fontKerning: "none",
                  fontVariantLigatures: "none",
                  letterSpacing: 0,
                }}
              >
                AttendAI
              </text>
            </clipPath>
          </defs>
        </svg>
        <div
          className="aw-portal-choices"
          role="radiogroup"
          aria-label="Choose a letter to enter through"
        >
          {Array.from("AttendAI", (letter, index) => (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked="false"
              aria-label={`Enter through ${letter}, letter ${index + 1}`}
              tabIndex={-1}
              data-portal-letter={index}
            />
          ))}
        </div>
        <div className="aw-portal-front">
          <a className="aw-wordmark" href="#homepage" aria-label="AttendAI home">
            AttendAI<span>.</span>
          </a>
          <span className="aw-portal-category">
            A more considered
            <br />
            institution day.
          </span>
          <p className="aw-portal-eyebrow">Good days begin with everyone accounted for.</p>
          <span className="aw-portal-fallback" aria-hidden="true">
            AttendAI
          </span>
          <div className="aw-portal-caption">
            <p>A clearer view of every day.</p>
            <a href="#homepage" className="aw-button aw-button-green">
              Step inside <span aria-hidden="true">↘</span>
            </a>
          </div>
          <p className="aw-portal-scroll">
            Pick a letter. Scroll to step inside. <span aria-hidden="true">↓</span>
          </p>
          <a href="/login" className="aw-portal-signin">
            Sign In ↗
          </a>
        </div>
      </div>
      <div className="aw-portal-content" id="homepage" tabIndex={-1}>
        {children}
      </div>
    </section>
  );
}
