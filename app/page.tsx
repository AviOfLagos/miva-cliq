import type { Metadata } from "next";
import GistsClient from "./gists/GistsClient";

export const metadata: Metadata = {
  title: { absolute: "Miva Cliq — anonymous notes from Miva students" },
  description:
    "Miva Gists: anonymous notes from Miva students on courses, lecturers, housing and more. Anonymous by default, or post under a handle.",
  openGraph: {
    title: "Miva Cliq",
    description: "Notes from Miva students — anonymous by default, or post under a handle.",
  },
};

/**
 * Home = the Gists community board. The coursework tool lives at /cliq.
 * GistsClient is publicly readable; posting is gated behind login.
 */
export default function HomePage() {
  return <GistsClient />;
}
