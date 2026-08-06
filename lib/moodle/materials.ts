/**
 * Course material harvesting (documents, folders, pages, external links).
 *
 * Miva's Moodle has the mod_* web services switched off (see quiz.ts), so this
 * walks the same URLs a browser would:
 *
 *   resource: GET /mod/resource/view.php?id=<cmid>&redirect=1
 *             -> 303 -> /pluginfile.php/.../<file>   (or an HTML embed page
 *                whose body links the same pluginfile URL)
 *   folder:   GET /mod/folder/view.php?id=<cmid>     -> N pluginfile links
 *   page:     GET /mod/page/view.php?id=<cmid>       -> HTML body we keep as .md
 *   url:      GET /mod/url/view.php?id=<cmid>&redirect=1 -> Location: <external>
 *
 * Nothing here mutates LMS state; every call is a GET.
 */
import { LMS, cookieHeader, type MoodleSession } from "./auth";
import type { Activity } from "./activities";
import { decodeEntities, htmlToMarkdown, mainRegion } from "@/lib/export/html";

/** Module types worth harvesting, in the order they should appear in a pack. */
export const MATERIAL_MODS = ["resource", "folder", "page", "book", "url"] as const;
export type MaterialMod = (typeof MATERIAL_MODS)[number];

export function isMaterial(a: Activity): boolean {
  return (MATERIAL_MODS as readonly string[]).includes(a.modname);
}

export interface FetchedFile {
  filename: string;
  bytes: Buffer;
  contentType: string;
}

function headers(session: MoodleSession, extra?: Record<string, string>) {
  return {
    cookie: cookieHeader(session.cookies),
    "user-agent": "Mozilla/5.0",
    ...(extra || {}),
  };
}

async function getText(session: MoodleSession, url: string): Promise<string> {
  const r = await fetch(url, { headers: headers(session), redirect: "follow" });
  return r.text().catch(() => "");
}

function filenameFrom(url: string, disposition: string | null): string {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  const raw = star || plain || url.split("?")[0].split("/").pop() || "file";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Download one URL as bytes. Returns null when the response is an HTML page
 * (i.e. not the file itself) or exceeds maxBytes.
 */
async function downloadBinary(
  session: MoodleSession,
  url: string,
  maxBytes: number,
): Promise<FetchedFile | null> {
  const r = await fetch(url, { headers: headers(session), redirect: "follow" });
  if (!r.ok) return null;
  const contentType = r.headers.get("content-type") || "";
  if (/text\/html/i.test(contentType)) return null;
  const declared = Number(r.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > maxBytes) return null;
  return { filename: filenameFrom(r.url || url, r.headers.get("content-disposition")), bytes, contentType };
}

/** Every /pluginfile.php link in a chunk of Moodle HTML, de-duplicated. */
export function pluginfileLinks(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]*\/pluginfile\.php\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = decodeEntities(m[1]);
    // Skip inline images/icons that Moodle renders inside the file listing.
    if (/\.(png|gif|svg|ico)(\?|$)/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export interface MaterialResult {
  /** Downloaded documents, ready to be written into the pack. */
  files: FetchedFile[];
  /** Text captured from `page`/`book` modules, as markdown. */
  text: string | null;
  /** External destination for `url` modules. */
  link: string | null;
  /** Why nothing came back, when files/text/link are all empty. */
  skipped: string | null;
}

const EMPTY: MaterialResult = { files: [], text: null, link: null, skipped: null };

/** Harvest a single activity. Never throws — failures come back as `skipped`. */
export async function fetchMaterial(
  session: MoodleSession,
  activity: Activity,
  maxBytes: number,
): Promise<MaterialResult> {
  try {
    switch (activity.modname) {
      case "resource":
        return await fetchResource(session, activity.cmid, maxBytes);
      case "folder":
        return await fetchFolder(session, activity.cmid, maxBytes);
      case "page":
        return await fetchPageMod(session, activity.cmid, "page");
      case "book":
        return await fetchPageMod(session, activity.cmid, "book");
      case "url":
        return await fetchUrlMod(session, activity.cmid);
      default:
        return { ...EMPTY, skipped: `unsupported activity type (${activity.modname})` };
    }
  } catch (e: any) {
    return { ...EMPTY, skipped: e?.message || "fetch failed" };
  }
}

async function fetchResource(
  session: MoodleSession,
  cmid: number,
  maxBytes: number,
): Promise<MaterialResult> {
  const direct = await downloadBinary(
    session,
    `${LMS}/mod/resource/view.php?id=${cmid}&redirect=1`,
    maxBytes,
  );
  if (direct) return { ...EMPTY, files: [direct] };

  // Embedded / "display in page" resources: the view page links the real file.
  const html = await getText(session, `${LMS}/mod/resource/view.php?id=${cmid}`);
  const links = pluginfileLinks(html);
  const files: FetchedFile[] = [];
  for (const link of links) {
    const f = await downloadBinary(session, link, maxBytes);
    if (f) files.push(f);
  }
  if (files.length) return { ...EMPTY, files };
  return {
    ...EMPTY,
    skipped: links.length ? "file too large or unreadable" : "no downloadable file found",
  };
}

async function fetchFolder(
  session: MoodleSession,
  cmid: number,
  maxBytes: number,
): Promise<MaterialResult> {
  const html = await getText(session, `${LMS}/mod/folder/view.php?id=${cmid}`);
  const links = pluginfileLinks(html);
  const files: FetchedFile[] = [];
  for (const link of links) {
    const f = await downloadBinary(session, link, maxBytes);
    if (f) files.push(f);
  }
  if (files.length) return { ...EMPTY, files };
  return { ...EMPTY, skipped: links.length ? "files too large or unreadable" : "empty folder" };
}

/**
 * `page` gives its whole body; `book` gives whatever chapter the view lands on
 * (usually the first) — chapter-by-chapter walking isn't worth it for the few
 * books Miva courses use.
 */
async function fetchPageMod(
  session: MoodleSession,
  cmid: number,
  mod: "page" | "book",
): Promise<MaterialResult> {
  const html = await getText(session, `${LMS}/mod/${mod}/view.php?id=${cmid}`);
  const md = htmlToMarkdown(mainRegion(html));
  if (md.length < 40) return { ...EMPTY, skipped: "no readable content" };
  return { ...EMPTY, text: md };
}

async function fetchUrlMod(session: MoodleSession, cmid: number): Promise<MaterialResult> {
  // redirect:"manual" keeps our Moodle cookies from being sent to the external host.
  const r = await fetch(`${LMS}/mod/url/view.php?id=${cmid}&redirect=1`, {
    headers: headers(session),
    redirect: "manual",
  });
  const loc = r.headers.get("location");
  if (loc && !loc.includes("lms.miva.university")) return { ...EMPTY, link: loc };
  const html = await r.text().catch(() => "");
  const inline = html.match(/<a[^>]*href="(https?:\/\/(?!lms\.miva\.university)[^"]+)"/i)?.[1];
  if (inline) return { ...EMPTY, link: decodeEntities(inline) };
  return { ...EMPTY, skipped: "no external link found" };
}
