import type { Metadata } from "next";
import StudyClient from "./StudyClient";

export const metadata: Metadata = {
  title: "Study",
  description:
    "Ready-made study prompts for each week of your Miva courses. Copy one into ChatGPT, Gemini or Grok to be taught, tested or drilled for the exam.",
  // Personal, session-gated page: keep it out of search results.
  robots: { index: false, follow: false },
};

export default function StudyPage() {
  return <StudyClient />;
}
