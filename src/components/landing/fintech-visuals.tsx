/** Adapted from Kedhareswer Naidu's publicly reusable Maroon Fintech Landing.
 * Original circuit geometry, mirrored traces and pulse timing are retained.
 * Provenance and reuse permission: docs/landing-page-references.md.
 */
import { useEffect, useId, useRef, useState } from "react";

const TRACES = [
  "M0 236H96M156 236H232Q252 236 252 256V336Q252 356 272 356H430Q450 356 450 376V560Q450 580 470 580H600",
  "M0 470H118M178 470H300Q320 470 320 490V640Q320 660 340 660H612",
  "M84 0V122Q84 142 104 142H170",
  "M0 640H96M156 640H200Q220 640 220 660V760Q220 780 240 780H560",
  "M0 356H24M84 356H160",
  "M330 0V140Q330 160 350 160H380",
];
const CHIPS = [
  { x: 126, y: 236, glyph: "✓" },
  { x: 148, y: 470, glyph: "A" },
  { x: 54, y: 356, glyph: "≡" },
  { x: 126, y: 640, glyph: "↗" },
  { x: 200, y: 142, glyph: "··" },
  { x: 410, y: 160, glyph: "◦" },
];

export function CircuitBoard({ dark = false }: { dark?: boolean }) {
  const id = "wire-" + useId().replaceAll(":", "");
  const ref = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [hot, setHot] = useState(-1);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => setRunning(visible && !document.hidden && !media.matches);
    const observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      media.removeEventListener("change", update);
    };
  }, []);
  const half = (side: number) => (
    <g transform={side ? "translate(1440 0) scale(-1 1)" : undefined}>
      {TRACES.map((d, i) => (
        <path key={"trace" + i} d={d} className="aw-trace" />
      ))}
      {TRACES.map((d, i) => (
        <path
          key={"pulse" + i}
          d={d}
          pathLength={1000}
          className="aw-pulse"
          stroke={`url(#${id})`}
          style={{
            animationDelay: -((i * 1.7 + side * 2.3) % 6) + "s",
            animationDuration: 5 + ((i + side) % 3) + "s",
          }}
        />
      ))}
      {CHIPS.map((chip, i) => (
        <g
          key={i}
          className={"aw-chip" + (hot === i + side * CHIPS.length ? " is-hot" : "")}
          transform={`translate(${chip.x} ${chip.y})`}
        >
          <rect x={-28} y={-16} width={56} height={32} rx={8} />
          <text x={0} y={4.5} textAnchor="middle" transform={side ? "scale(-1 1)" : undefined}>
            {chip.glyph}
          </text>
        </g>
      ))}
    </g>
  );
  return (
    <div
      ref={ref}
      className={"aw-circuit" + (dark ? " aw-circuit-dark" : "")}
      data-running={running}
      aria-hidden="true"
      onPointerMove={(event) => {
        if (!running || event.pointerType !== "mouse") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 1440,
          y = ((event.clientY - bounds.top) / bounds.height) * 900;
        let nearest = -1,
          distance = 130;
        for (let side = 0; side < 2; side++)
          CHIPS.forEach((c, i) => {
            const delta = Math.hypot(x - (side ? 1440 - c.x : c.x), y - c.y);
            if (delta < distance) {
              nearest = i + side * CHIPS.length;
              distance = delta;
            }
          });
        setHot((previous) => (previous === nearest ? previous : nearest));
      }}
      onPointerLeave={() => setHot(-1)}
    >
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
            <stop offset=".7" stopColor="var(--accent)" stopOpacity=".55" />
            <stop offset="1" stopColor="var(--wire-glow)" stopOpacity=".9" />
          </linearGradient>
        </defs>
        {half(0)}
        {half(1)}
      </svg>
    </div>
  );
}

export function AttendanceDevice() {
  const id = "device-" + useId().replaceAll(":", "");
  return (
    <svg
      className="aw-device"
      viewBox="0 0 320 320"
      width={320}
      height={320}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id + "face"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".45" stopColor="#fff" stopOpacity=".04" />
          <stop offset="1" stopColor="#000" stopOpacity=".22" />
        </linearGradient>
        <radialGradient id={id + "sheen"} cx=".28" cy=".22" r=".7">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id + "side"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".05" />
          <stop offset="1" stopColor="#000" stopOpacity=".45" />
        </linearGradient>
        <linearGradient id={id + "led"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--wire-glow)" stopOpacity="0" />
          <stop offset=".55" stopColor="var(--wire-glow)" stopOpacity=".95" />
          <stop offset=".8" stopColor="#fff6e0" />
          <stop offset="1" stopColor="var(--wire-glow)" stopOpacity=".2" />
        </linearGradient>
      </defs>
      <g transform="rotate(-14 160 160)">
        <rect x="46" y="58" width="228" height="228" rx="76" fill="var(--device)" />
        <rect x="46" y="58" width="228" height="228" rx="76" fill={`url(#${id}side)`} />
        <path
          d="M268 160Q270 258 172 276"
          fill="none"
          stroke={`url(#${id}led)`}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <rect x="46" y="44" width="228" height="228" rx="76" fill="var(--device)" />
        <rect x="46" y="44" width="228" height="228" rx="76" fill={`url(#${id}face)`} />
        <rect x="46" y="44" width="228" height="228" rx="76" fill={`url(#${id}sheen)`} />
        <rect
          x="47"
          y="45"
          width="226"
          height="226"
          rx="75"
          fill="none"
          stroke="#fff"
          strokeOpacity=".35"
          strokeWidth="1.4"
        />
        <path
          d="m131 187 29-68 29 68m-46-23h34"
          fill="none"
          stroke="#373029"
          strokeOpacity=".65"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m132 188 29-68 29 68m-46-23h34"
          fill="none"
          stroke="#fff"
          strokeOpacity=".3"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}
