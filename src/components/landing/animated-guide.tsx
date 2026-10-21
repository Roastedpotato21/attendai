import { useEffect, useRef, type ReactNode } from "react";

/** Retains native details/summary semantics and animates both opening and closing. */
export function AnimatedGuide({
  question,
  children,
}: {
  question: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const animation = useRef<Animation | null>(null);
  const expanded = useRef(false);
  useEffect(() => () => animation.current?.cancel(), []);
  function toggle(event: React.MouseEvent<HTMLElement>) {
    const details = ref.current;
    if (!details) return;
    event.preventDefault();
    const start = details.getBoundingClientRect().height;
    animation.current?.cancel();
    expanded.current = !expanded.current;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !details.animate) {
      details.open = expanded.current;
      details.style.height = "";
      return;
    }
    details.style.height = "";
    details.open = true;
    const end = expanded.current
      ? details.getBoundingClientRect().height
      : details.querySelector("summary")!.getBoundingClientRect().height + 1;
    const current = details.animate([{ height: `${start}px` }, { height: `${end}px` }], {
      duration: 420,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    animation.current = current;
    current.onfinish = () => {
      details.open = expanded.current;
      animation.current = null;
    };
  }
  return (
    <details ref={ref}>
      <summary onClick={toggle}>{question}</summary>
      <div>{children}</div>
    </details>
  );
}
