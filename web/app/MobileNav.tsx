"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOUNT, PRIMARY, REFERENCE } from "@/lib/nav";
import SignOutButton from "./SignOutButton";

/** The phone navigation.
 *
 *  Below 42rem the masthead nav is hidden, and until now the footer was the only way to reach any
 *  page. That works until someone adds a page and forgets the footer, which already happened once.
 *
 *  Everything the desktop masthead offers is here, including sign out, which stays a POST form: as a
 *  link a prefetch could sign someone out.
 */
export default function MobileNav({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mobile-nav" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="mobile-nav-trigger"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="bars" aria-hidden />
      </button>

      {open ? (
        <div className="mobile-nav-panel">
          {PRIMARY.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <span className="mobile-nav-rule" aria-hidden />
          {REFERENCE.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <span className="mobile-nav-rule" aria-hidden />
          {email ? (
            <>
              {ACCOUNT.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
                  {l.label}
                </a>
              ))}
              <SignOutButton className="nav-menu-signout" />
            </>
          ) : (
            <a href="/signin" onClick={() => setOpen(false)}>
              Sign in / up
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
