import type { Metadata } from "next";
import AnswersClient from "./AnswersClient";

export const metadata: Metadata = {
  title: "Answer bank",
  description:
    "Shared answers for Miva ungraded practice quizzes — crowd-verified by students. Ungraded practice only.",
  // Not a public marketing surface; keep it out of search results.
  robots: { index: false, follow: false },
};

export default function AnswersPage() {
  return <AnswersClient />;
}
