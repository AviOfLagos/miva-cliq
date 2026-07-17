import type { Metadata } from "next";
import GistsClient from "./GistsClient";

export const metadata: Metadata = {
  title: "Gists",
  description:
    "Anonymous notes from Miva students — courses, lecturers, housing and more. No names, no profiles.",
  openGraph: {
    title: "Miva Gists",
    description: "Anonymous notes from Miva students. No names, no profiles.",
  },
};

export default function GistsPage() {
  return <GistsClient />;
}