import type { Metadata } from "next";
import GistsClient from "./GistsClient";

export const metadata: Metadata = {
  title: "Gists",
  description:
    "Anonymous notes from Miva students — courses, lecturers, housing and more. Anonymous by default, or post under a handle.",
  openGraph: {
    title: "Miva Gists",
    description: "Notes from Miva students — anonymous by default, or post under a handle.",
  },
};

export default function GistsPage() {
  return <GistsClient />;
}