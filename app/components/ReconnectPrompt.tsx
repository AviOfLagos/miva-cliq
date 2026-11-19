"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Shown where a page needs the live Miva session but the student is still
 * signed in through the 30-day identity cookie. One short ask instead of a
 * generic "couldn't load" error. Links to the login form on /cliq, which sends
 * the student back here afterwards (`next`).
 */
export default function ReconnectPrompt({ what }: { what: string }) {
  const pathname = usePathname();
  const href = pathname && pathname !== "/cliq" ? `/cliq?next=${encodeURIComponent(pathname)}` : "/cliq";
  return (
    <div className="alert alert-notice" role="status">
      <span>
        You&apos;re still signed in, but your Miva connection has timed out. Reconnect to
        Miva to {what}.
      </span>
      <Link href={href} className="btn btn-primary btn-sm">
        Reconnect to Miva
      </Link>
    </div>
  );
}
