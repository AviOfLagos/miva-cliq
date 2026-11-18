"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/run/AppContext";
import { loadStudyAskDone, saveStudyAskDone } from "@/lib/run/prefs";

/**
 * The one question after login: "Want a study plan for your courses?"
 * Shown once per device to a logged-in student; either answer retires it.
 */
export default function StudyAsk() {
  const { authed } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  // Start hidden and read storage after mount, so server and client HTML match.
  const [done, setDone] = useState(true);

  useEffect(() => {
    setDone(loadStudyAskDone());
  }, []);

  if (!authed || done || pathname === "/study") return null;

  const close = () => {
    saveStudyAskDone();
    setDone(true);
  };

  return (
    <div className="alert alert-notice study-ask" role="region" aria-label="Study plan">
      <span>Want a study plan for your courses?</span>
      <span className="study-ask-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            close();
            router.push("/study");
          }}
        >
          Yes, show me
        </button>
        <button type="button" className="icon-btn" onClick={close} aria-label="No thanks">
          ✕
        </button>
      </span>
    </div>
  );
}
