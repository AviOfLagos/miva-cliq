"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/run/AppContext";

const NAV = [
  { href: "/", label: "Gists" },
  { href: "/events", label: "Events" },
  { href: "/answers", label: "Answers" },
  { href: "/study-pack", label: "Study pack" },
];

export default function TopBar() {
  const { name, screen, isRunning, totals, pct, setScreen } = useApp();
  const pathname = usePathname();
  const router = useRouter();

  // The run keeps going while the user browses other pages; this jumps back to
  // the full log on the Cliq tab.
  const openRun = () => {
    setScreen("run");
    if (pathname !== "/cliq") router.push("/cliq");
  };

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
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`topnav-link ${pathname === n.href ? "is-current" : ""}`}
              aria-current={pathname === n.href ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
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
      </div>
    </header>
  );
}