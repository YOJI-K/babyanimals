import type { NewsItem } from './ingest';

/**
 * YouTube Data API v3 からチャンネルの最新動画を取得
 */
export async function ingestYouTube(apiKey: string, channelIds: string[]): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const ch of channelIds) {
    try {
      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
      searchUrl.searchParams.set("key", apiKey);
      searchUrl.searchParams.set("channelId", ch);
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("order", "date");
      searchUrl.searchParams.set("maxResults", "20");
      searchUrl.searchParams.set("type", "video");

      const res = await fetch(searchUrl.toString());
      const json = await res.json();
      const items = (json.items || []) as any[];
      for (const it of items) {
        const videoId = it.id?.videoId;
        const sn = it.snippet;
        if (!videoId || !sn) continue;
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        out.push({
          title: sn.title || "(no title)",
          url,
          published_at: sn.publishedAt || new Date().toISOString(),
          source_name: "YouTube",
          source_url: `https://www.youtube.com/channel/${ch}`,
          thumbnail_url: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url,
        });
      }
    } catch (e) {
      console.warn("YouTube ingest failed:", ch, e);
    }
  }
  return dedupeByUrl(out);
}

function dedupeByUrl(arr: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const a of arr) {
    if (!seen.has(a.url)) { seen.add(a.url); out.push(a); }
  }
  return out;
}
