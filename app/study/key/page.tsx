import type { Metadata } from "next";
import KeyClient from "./KeyClient";

export const metadata: Metadata = {
  title: "Get a free Gemini key",
  description:
    "Two minutes in Google AI Studio gets you a free Gemini API key, so you can create practice questions for your Miva courses.",
};

export const dynamic = "force-dynamic";

export default function KeyPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const raw = Array.isArray(searchParams.back) ? searchParams.back[0] : searchParams.back;
  // Only ever link back into our own Study or practice screen.
  const back =
    raw && (raw === "/study" || /^\/study\/practice\?course=[a-z]{2,5}\d{3}&week=\d{1,2}(&cid=\d{1,9})?$/.test(raw))
      ? raw
      : null;
  return <KeyClient back={back} />;
}
