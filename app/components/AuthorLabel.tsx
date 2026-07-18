/**
 * Renders a post/reply author: a distinct @handle when named, the faint
 * "Anonymous" otherwise. One place so every surface reads the same.
 */
export default function AuthorLabel({ name }: { name: string | null }) {
  if (name) {
    return <span className="gist-author gist-author-named">@{name}</span>;
  }
  return <span className="gist-author">Anonymous</span>;
}
