import type { Metadata } from "next";
import GistsClient from "./gists/GistsClient";

export const metadata: Metadata = {
  title: { absolute: "Miva Cliq — anonymous notes from Miva students" },
  description:
    "Miva Gists: anonymous notes from Miva students on courses, lecturers, housing and more. No names, no profiles.",
  openGraph: {
    title: "Miva Cliq",
    description: "Anonymous notes from Miva students. No names, no profiles.",
  },
};

/**
 * Home = the Gists community board. The coursework tool lives at /cliq.
 * GistsClient is publicly readable; posting is gated behind login.
 */
export default function HomePage() {
  return <GistsClient />;
}
