import type { Metadata } from "next";
import BrowseClient from "./BrowseClient";

export const metadata: Metadata = {
  title: "Browse all courses",
  description: "Practise any Miva course classmates have prepared, in any department, enrolled or not.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function BrowsePage() {
  return <BrowseClient />;
}
