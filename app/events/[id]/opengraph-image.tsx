import { getEvent } from "@/lib/store/events";
import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const alt = "An event on Miva Cliq";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: { id: string } }) {
  const event = await getEvent(params.id);
  if (!event) {
    return ogImage({ kicker: "MIVA EVENTS", heading: "This event is gone.", emoji: "📅" });
  }
  const when = new Date(event.startsAt).toLocaleString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  const sub = event.location ? `${when} · ${event.location}` : when;
  return ogImage({ kicker: "MIVA EVENTS", heading: event.title, sub, emoji: "📅" });
}