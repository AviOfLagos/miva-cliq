/**
 * Tiny HTML -> text/markdown helpers for the study-pack exporter.
 *
 * Moodle page/label content is simple authored HTML (headings, lists, links,
 * tables at worst), so a regex pass beats pulling in a parser. Output is aimed
 * at NotebookLM / plain reading, not at round-tripping the original markup.
 */

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/&lsquo;|&#8216;/gi, "'")
    .replace(/&ldquo;|&#8220;/gi, '"')
    .replace(/&rdquo;|&#8221;/gi, '"')
    .replace(/&ndash;|&#8211;/gi, "-")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/gi, "&"); // last, so &amp;lt; survives as &lt;
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Convert a fragment of Moodle-authored HTML into readable markdown. */
export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  s = s
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => {
      const text = stripTags(inner);
      return text ? `\n\n${"#".repeat(Math.min(6, Number(lvl) + 1))} ${text}\n\n` : "\n";
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
      const text = stripTags(inner);
      return text ? `\n- ${text}` : "";
    })
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const text = stripTags(inner);
      return text ? `[${text}](${decodeEntities(href)})` : decodeEntities(href);
    })
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => {
      const text = stripTags(inner);
      return text ? `**${text}**` : "";
    })
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => {
      const text = stripTags(inner);
      return text ? `*${text}*` : "";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|ul|ol|table|section)>/gi, "\n\n")
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => (alt ? `[image: ${alt}]` : ""))
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pull Moodle's main content region out of a full page. */
export function mainRegion(html: string): string {
  const roleMain = html.match(/<div[^>]*role="main"[^>]*>([\s\S]*)/i);
  const body = roleMain ? roleMain[1] : html;
  const box = body.match(
    /<div[^>]*class="[^"]*\bgeneralbox\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  if (box) return box[1];
  // Fall back to everything before the footer / secondary navigation.
  return body.split(/<footer|id="page-footer"/i)[0];
}
