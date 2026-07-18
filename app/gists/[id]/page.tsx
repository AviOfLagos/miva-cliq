import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGist } from "@/lib/store/gists";
import { categoryLabel } from "@/lib/taxonomy";
import { snippet } from "@/lib/format";
import GistDetail from "./GistDetail";

type Props = { params: { id: string } };

// Each gist is its own shareable link, so its card and title come from the post.
// noindex: posts are anonymous by default, and permanently indexing them would
// defeat that. Link-preview cards still work — robots only stops search
// cataloguing, not the OG/Twitter meta a chat app reads when the URL is shared.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const gist = await getGist(params.id);
  if (!gist) return { title: "Gist not found", robots: { index: false, follow: false } };
  const desc = snippet(gist.body, 160);
  const title = snippet(gist.body, 60);
  return {
    title,
    description: desc,
    robots: { index: false, follow: false },
    openGraph: { title: `Miva Gists · ${categoryLabel(gist.category)}`, description: desc },
    twitter: { card: "summary_large_image", title, description: desc },
  };
}

export default async function GistPage({ params }: Props) {
  // Server-fetch so the post is in the initial HTML (good for the crawler that
  // rendered the card); the client island then handles replies and editing.
  const gist = await getGist(params.id);
  if (!gist) notFound();
  return <GistDetail initialGist={gist} />;
}