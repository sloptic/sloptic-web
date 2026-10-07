"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The two moving parts of /findings-demo. Both render their finished state on the server, so the page
// reads the same with no script, and both stand still for anyone who asks for reduced motion.

const still = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rises into view the first time it is scrolled to. Never nest one inside another: a hidden inner one
 *  under a revealed outer one would match both states' rules. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"static" | "hidden" | "in">("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || still()) return;
    setState("hidden");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setState("in");
          io.disconnect();
        }
      },
      { threshold: 0.3, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${state} ${className}`.trim()} style={{ ["--d" as string]: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** A number that counts up from 0 the first time it is on screen. */
export function Count({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const show = (v: number) =>
    prefix + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(show(to));
  useEffect(() => {
    const el = ref.current;
    if (!el || still()) return;
    setText(show(0));
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / 1400);
          setText(show(to * (1 - Math.pow(1 - p, 3))));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // show is rebuilt each render from the same props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, decimals, prefix, suffix]);
  return (
    <span ref={ref} className="count">
      {text}
    </span>
  );
}
