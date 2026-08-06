import type { Metadata } from "next";
import StudyPackClient from "./StudyPackClient";

export const metadata: Metadata = {
  title: "Study pack",
  description:
    "Download a Miva course as one offline folder: shared documents plus the questions from its ungraded practice quizzes.",
  // Personal, session-gated tooling — keep it out of search results.
  robots: { index: false, follow: false },
};

export default function StudyPackPage() {
  return <StudyPackClient />;
}
