import type { Metadata } from "next";
import EventsClient from "./EventsClient";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Study groups, meetups and deadlines at Miva — posted by students, for students.",
  openGraph: {
    title: "Miva Events",
    description: "Study groups, meetups and deadlines — posted by students, for students.",
  },
};

export default function EventsPage() {
  return <EventsClient />;
}