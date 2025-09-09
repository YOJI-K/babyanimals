import { ingestRssFeeds } from './rss';
import { ingestYouTube } from './youtube';

import { upsertNewsItems } from './supabase';

export async function ingestAll(env: EnvLike) {
  const rssSources: string[] = parseJsonArray(env.RSS_SOURCES);
  const ytChannels: string[] = (env.YOUTUBE_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

  const collected = [] as NewsItem[];

  if (rssSources.length > 0) {
    const items = await ingestRssFeeds(rssSources);
    collected.push(...items);
  }

  if (env.YOUTUBE_API_KEY && ytChannels.length > 0) {
    const items = await ingestYouTube(env.YOUTUBE_API_KEY, ytChannels);
    collected.push(...items);
  }

  if (collected.length > 0) {
    await upsertNewsItems(env, collected);
  }

  return { counts: { collected: collected.length } };
}

// ---- Types & utils ----
export interface EnvLike {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE: string;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_CHANNEL_IDS?: string;
  RSS_SOURCES?: string;
}

export interface NewsItem {
  title: string;
  url: string;
  published_at: string; // ISO8601
  source_name: string;
  source_url: string;
  thumbnail_url?: string;
  baby_id?: string | null;
  zoo_id?: string | null;
}

function parseJsonArray(input?: string): string[] {
  if (!input) return [];
  try { const arr = JSON.parse(input); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
