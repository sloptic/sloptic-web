"use client";

import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string };

/** A disclosure menu for the masthead.
 *
 *  Click to open, not hover. A hover menu has no equivalent on a touch screen and opens itself when
 *  the pointer merely crosses it, and this one sits next to the links people actually aim for.
 *
 *  Built as a button with aria-expanded rather than a styled <details>, because the behaviour people
 *  expect from a nav menu is not what <details> does: it stays open when you click elsewhere and when
 *  you navigate back to the page. Escape and an outside click both close it here, and focus returns
 *  to the trigger on Escape so a keyboard user is not dropped at the top of the document.
 */
export default function NavMenu({
  label,
  items,
  title,
  align = "center",
  children,
}: {
  label: string;
  items: Item[];
  /** Full text for a label the CSS may truncate, such as a long email address. */
  title?: string;
  align?: "center" | "right";
  /** Rendered under the links. Exists so the account menu can hold sign out, which has to be a POST
   *  form rather than a link: signing out changes state, and a link would let a prefetch or a
   *  crawler do it. */
  children?: React.ReactNode;
}) {
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
    <div className="nav-menu" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="nav-menu-trigger"
        title={title}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="nav-menu-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="nav-menu-panel" data-align={align}>
          {items.map((it) => (
            <a key={it.href} href={it.href} onClick={() => setOpen(false)}>
              {it.label}
            </a>
          ))}
          {children}
        </div>
      ) : null}
    </div>
  );
}
