import { getGist } from "@/lib/store/gists";
import { categoryLabel } from "@/lib/taxonomy";
import { snippet } from "@/lib/format";
import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const runtime = "nodejs";
export const alt = "A gist on Miva Cliq";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: { id: string } }) {
  const gist = await getGist(params.id);
  if (!gist) {
    return ogImage({ kicker: "MIVA GISTS", heading: "This gist is gone.", emoji: "💬" });
  }
  return ogImage({
    kicker: `MIVA GISTS · ${categoryLabel(gist.category).toUpperCase()}`,
    heading: snippet(gist.body, 120),
    sub: "Anonymous notes from Miva students.",
    emoji: "💬",
  });
}