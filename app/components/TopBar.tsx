"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/run/AppContext";

const NAV = [
  { href: "/", label: "Gists" },
  { href: "/events", label: "Events" },
  { href: "/answers", label: "Answers" },
  { href: "/study", label: "Study" },
  { href: "/study-pack", label: "Study pack" },
];

export default function TopBar() {
  const { name, screen, isRunning, totals, pct, setScreen, authed, logOut } = useApp();
  const pathname = usePathname();
  const router = useRouter();

  // Small-screen menu. The inline links are hidden below 720px (globals.css),
  // so this is the only way to reach them on a phone.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) menuBtn.current?.focus();
  }, []);

  // Close on navigation. A tapped link changes the route; the panel must not
  // linger over the new page.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    // Move focus into the panel so keyboard and screen-reader users land on
    // the links they just asked for.
    menuPanel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuPanel.current?.contains(t) || menuBtn.current?.contains(t)) return;
      closeMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen, closeMenu]);

  // Tabbing out of the open panel closes it, so it never sits open behind focus.
  const onPanelBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && (menuPanel.current?.contains(next) || menuBtn.current?.contains(next))) return;
    if (next) setMenuOpen(false);
  };

  // The run keeps going while the user browses other pages; this jumps back to
  // the full log on the Cliq tab.
  const openRun = () => {
    setScreen("run");
    if (pathname !== "/cliq") router.push("/cliq");
  };

  const doLogOut = async () => {
    setMenuOpen(false);
    await logOut();
    if (pathname !== "/cliq") router.push("/cliq");
  };

  const links = (extra: string) =>
    NAV.map((n) => (
      <Link
        key={n.href}
        href={n.href}
        className={`topnav-link ${extra} ${pathname === n.href ? "is-current" : ""}`}
        aria-current={pathname === n.href ? "page" : undefined}
      >
        {n.label}
      </Link>
    ));

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="brand" aria-label="Miva Cliq home">
          <span className="brand-mark" aria-hidden="true">
            ⚡
          </span>
          <span className="brand-name">Miva&nbsp;Cliq</span>
        </Link>
        <nav className="topnav-links" aria-label="Main">
          {links("")}
        </nav>
      </div>

      <div className="topbar-right">
        {isRunning && !(pathname === "/cliq" && screen === "run") ? (
          <button
            type="button"
            className="run-pill"
            onClick={openRun}
            title="View the full run log"
          >
            <span className="run-pill-track" aria-hidden="true">
              <span className="run-pill-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="run-pill-count">
              {totals.total > 0 ? `${totals.handled}/${totals.total}` : "…"}
            </span>
            <span className="sr-only">
              Run in progress, {pct}% complete. View the full log.
            </span>
          </button>
        ) : null}

        {screen !== "login" && name ? (
          <div className="topbar-user" title={name}>
            <span className="avatar" aria-hidden="true">
              {name.trim().charAt(0).toUpperCase() || "M"}
            </span>
            <span className="topbar-name">{name}</span>
          </div>
        ) : null}

        {authed ? (
          <button type="button" className="topnav-link topnav-logout" onClick={doLogOut}>
            Log out
          </button>
        ) : null}

        <Link
          href="/cliq"
          className={`nav-cta ${pathname === "/cliq" ? "is-current" : ""}`}
          aria-current={pathname === "/cliq" ? "page" : undefined}
        >
          <span className="nav-cta-icon" aria-hidden="true">
            ⚡
          </span>
          <span className="nav-cta-label">Autopilot</span>
        </Link>

        <button
          ref={menuBtn}
          type="button"
          className="topnav-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="topnav-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {menuOpen ? (
        <div ref={menuPanel} id="topnav-menu" className="topnav-menu" onBlur={onPanelBlur}>
          <nav aria-label="Main">{links("topnav-menu-link")}</nav>
          {authed ? (
            <button type="button" className="topnav-link topnav-menu-link" onClick={doLogOut}>
              Log out
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
