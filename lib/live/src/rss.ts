/**
 * Minimal RSS 2.0 / Atom reader.
 *
 * Deliberately small rather than a dependency: the app only needs a title, a
 * link, a timestamp and an author out of each entry, and every feed it reads
 * was checked against that shape. Anything it cannot parse is skipped rather
 * than throwing, because one malformed entry must not cost the whole feed.
 */

export interface FeedEntry {
  title: string;
  link: string | null;
  author: string | null;
  /** ISO 8601, or null when the feed's date is missing or unparseable. */
  publishedAt: string | null;
}

/** Strip CDATA, decode the handful of entities feeds actually use, trim. */
function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ")
    // Ampersand last, so a literal &amp;lt; does not become a tag.
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function firstTag(block: string, ...names: string[]): string | null {
  for (const name of names) {
    // Tag name must end at a space, slash or '>' so <link> does not match
    // <linkinfo>, and namespaced tags (dc:creator) are addressable by name.
    const match = block.match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
    );
    if (match?.[1]) {
      const value = decode(match[1]);
      if (value) return value;
    }
  }
  return null;
}

/** Atom links carry the URL in an href attribute rather than as text. */
function atomLink(block: string): string | null {
  const match = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ?? null;
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseFeed(xml: string): FeedEntry[] {
  const blocks = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];

  const entries: FeedEntry[] = [];
  for (const block of blocks) {
    const title = firstTag(block, "title");
    if (!title) continue; // an entry with no headline is not usable

    entries.push({
      title,
      link: firstTag(block, "link") ?? atomLink(block),
      author: firstTag(block, "dc:creator", "creator", "author", "name"),
      publishedAt: toIso(firstTag(block, "pubDate", "published", "updated", "dc:date")),
    });
  }

  return entries;
}
