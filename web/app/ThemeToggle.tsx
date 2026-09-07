"use client";

import { useEffect, useState } from "react";

// Flips between light and dark, persisting the choice. Default (no choice) follows the system, which the
// CSS handles via prefers-color-scheme; this only writes an explicit override.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("sloptic-theme");
    } catch {
      /* private mode, ignore */
    }
    // Re-applying the stored choice here is normally a no-op: the inline script in the layout
    // already did it before first paint. It is NOT a no-op on Next's error shell. notFound() and a
    // crashed page are served from a bare document that never runs that script, so those pages
    // arrived on the system theme while the rest of the site sat on the chosen one, which is the
    // light page that appears in the middle of a dark site. The layout still mounts on that shell,
    // so this effect is the only thing left that runs there. It costs a flash on those two pages,
    // which beats the wrong theme.
    if (stored) document.documentElement.setAttribute("data-theme", stored);
    const explicit = stored ?? document.documentElement.getAttribute("data-theme");
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(explicit || system);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sloptic-theme", next);
    } catch {
      /* private mode, ignore */
    }
    setTheme(next);
  }

  // Render a stable label until mounted to avoid a hydration mismatch.
  const label = theme === "dark" ? "light mode" : "dark mode";
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${label}`}>
      {theme ? label : "theme"}
    </button>
  );
}
