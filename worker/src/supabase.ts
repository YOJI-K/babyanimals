import type { NewsItem, EnvLike } from './ingest';

/**
 * Supabase REST(PostgREST) を用いた upsert。
 * 推奨: news_items.url に UNIQUE 制約を付与しておくと二重登録を防ぎやすい。
 */
export async function upsertNewsItems(env: EnvLike, items: NewsItem[]) {
  // 既存URLとの重複を避けるため、URL集合をチェック → 新規のみPOST
  const urls = items.map(i => i.url);
  const existing = await fetchExisting(env, urls);
  const existingSet = new Set(existing.map(e => e.url));

  const newOnes = items.filter(i => !existingSet.has(i.url));
  if (newOnes.length === 0) return;

  const payload = newOnes.map(i => ({
    title: i.title,
    url: i.url,
    published_at: i.published_at,
    source_name: i.source_name,
    source_url: i.source_url,
    thumbnail_url: i.thumbnail_url ?? null,
    baby_id: i.baby_id ?? null,
    zoo_id: i.zoo_id ?? null,
  }));

  const endpoint = `${env.SUPABASE_URL}/rest/v1/news_items`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${t}`);
  }
}

async function fetchExisting(env: EnvLike, urls: string[]): Promise<{ url: string }[]> {
  // URL IN (...) はURL長でエスケープが大変なことがあるので分割して問い合わせ
  const CHUNK = 50;
  const out: { url: string }[] = [];
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    // or= を使って URL の等価比較をまとめる
    const or = chunk.map(u => `url.eq.${encodeURIComponent(u)}`).join(",");
    const endpoint = `${env.SUPABASE_URL}/rest/v1/news_items?select=url&or=(${or})`;

    const res = await fetch(endpoint, {
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        "Accept": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Supabase select failed: ${res.status}`);
    const json = await res.json();
    out.push(...json);
  }
  return out;
}
