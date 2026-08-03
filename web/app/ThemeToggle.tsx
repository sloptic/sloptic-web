"use client";

import { useEffect, useState } from "react";

// Flips between light and dark, persisting the choice. Default (no choice) follows the system, which the
// CSS handles via prefers-color-scheme; this only writes an explicit override.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    const explicit = document.documentElement.getAttribute("data-theme");
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
