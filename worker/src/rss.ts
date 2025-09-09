import type { NewsItem } from './ingest';

/**
 * 極めて単純なRSS/Atomパーサ（依存ゼロ）。
 * ※ 本番では堅牢なパーサ導入を推奨（feedの差異に弱い）。
 */
export async function ingestRssFeeds(feeds: string[]): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const feedUrl of feeds) {
    try {
      const res = await fetch(feedUrl, { headers: { "accept": "application/rss+xml, application/xml, text/xml" } });
      const xml = await res.text();
      const items = parseRss(xml).slice(0, 20); // 直近20件
      for (const it of items) {
        out.push({
          title: it.title || "(no title)",
          url: it.link,
          published_at: (it.pubDate || it.updated || new Date().toISOString()),
          source_name: hostFrom(feedUrl),
          source_url: feedUrl,
        });
      }
    } catch (e) {
      // 失敗はスキップ（ログだけ）
      console.warn("RSS ingest failed:", feedUrl, e);
    }
  }
  return dedupeByUrl(out);
}

function parseRss(xml: string): Array<{ title: string; link: string; pubDate?: string; updated?: string }> {
  // RSS 2.0 <item> / Atom <entry> を雑に抽出
  const items: any[] = [];

  // RSS item
  const rssItemRe = /<item[\s\S]*?<\/item>/gi;
  const atomEntryRe = /<entry[\s\S]*?<\/entry>/gi;

  const titleRe = /<title>([\s\S]*?)<\/title>/i;
  const linkRe = /<link>([\s\S]*?)<\/link>/i;
  const linkHrefRe = /<link[^>]*href=["']([^"']+)["'][^>]*>/i;
  const pubDateRe = /<pubDate>([\s\S]*?)<\/pubDate>/i;
  const updatedRe = /<updated>([\s\S]*?)<\/updated>/i;

  const rssMatches = xml.match(rssItemRe) || [];
  for (const block of rssMatches) {
    const title = (block.match(titleRe)?.[1] || "").replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
    const link = (block.match(linkRe)?.[1] || "").replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
    const pubDate = (block.match(pubDateRe)?.[1] || "").trim();
    if (link) items.push({ title, link, pubDate });
  }

  const atomMatches = xml.match(atomEntryRe) || [];
  for (const block of atomMatches) {
    const title = (block.match(titleRe)?.[1] || "").replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim();
    const link = (block.match(linkHrefRe)?.[1] || "").trim() || (block.match(linkRe)?.[1] || "").trim();
    const updated = (block.match(updatedRe)?.[1] || "").trim();
    if (link) items.push({ title, link, updated });
  }

  return items;
}

function hostFrom(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}

function dedupeByUrl(arr: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const a of arr) {
    if (!seen.has(a.url)) { seen.add(a.url); out.push(a); }
  }
  return out;
}
