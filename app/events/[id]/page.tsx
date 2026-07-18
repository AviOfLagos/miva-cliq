import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/store/events";
import { snippet } from "@/lib/format";
import EventDetail from "./EventDetail";

type Props = { params: { id: string } };

function whenLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getEvent(params.id);
  if (!event)
    return { title: "Event not found", robots: { index: false, follow: false } };
  const desc = snippet(
    `${whenLabel(event.startsAt)}${event.location ? ` · ${event.location}` : ""}${
      event.body ? ` — ${event.body}` : ""
    }`,
    160,
  );
  // noindex — see the note in app/gists/[id]/page.tsx. Link previews still work.
  return {
    title: event.title,
    description: desc,
    robots: { index: false, follow: false },
    openGraph: { title: event.title, description: desc },
    twitter: { card: "summary_large_image", title: event.title, description: desc },
  };
}

export default async function EventPage({ params }: Props) {
  const event = await getEvent(params.id);
  if (!event) notFound();
  return <EventDetail initialEvent={event} />;
}