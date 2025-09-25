// worker/src/index.ts
// Baby Animals - Crawler/Resolver Worker
// ランタイム: Cloudflare Workers (Service bindings: SUPABASE_URL, SUPABASE_SERVICE_ROLE)
// 目的:
//  1) 収集結果はまず "イベント(baby_events)" として保存し、babies は解決ジョブでのみ新規/更新
//  2) YouTube は観察イベントとして保存しつつ、条件次第で新規作成も許可
//  3) 公式サイト（sources.kind='site'）の一覧から最新記事を抽出してイベント化（出生系見出しを事前フィルタ）
//  4) マッチキーは (zoo_id, species, birthday±k日) を中核
//  5) babies 作成時はソース（ドメイン/タイトル）から zoo_id を推定して補完

export interface Env {
  SUPABASE_URL: string;                // 例: https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE: string;       // Supabase Service Role key（Secret）
  RUN_TOKEN?: string;                  // GET /run 用の手動実行トークン（オプショナル）
}

// -------------------------------
// 小さな共通ユーティリティ
// -------------------------------
const JP_TZ = 'Asia/Tokyo';

// news/site 抽出の1回当たり処理ソース上限
const MAX_SOURCES_PER_RUN = 25;      // (news 用)

// 1ソースから抽出する最大イベント数（主にRSS用の上限）
const MAX_EVENTS_PER_SOURCE = 30;

// 一括書き込みチャンク
const MAX_UPSERT_CHUNK = 500;

// resolve のサブリクエスト抑制用
const RESOLVE_BATCH_LIMIT = 20;   // 1回に処理する未処理イベント数
const PATCH_CHUNK = 200;          // processed_at 更新の id チャンク
const LINKS_CHUNK = 500;          // baby_links 一括 POST のチャンク

// 公式サイト収集ジョブの上限（サブリクエスト抑制）
const MAX_SITE_SOURCES_PER_RUN = 5;          // 1回で回す site ソース数（控えめ）
const SITE_DETAIL_FETCH_LIMIT   = 8;          // 1サイトから記事詳細を掘る最大件数
const BIRTH_KW = /(誕生|出産|赤ちゃん|赤仔|ベビー|命名|生まれ)/; // 一覧テキストの事前フィルタ

function nowIso() { return new Date().toISOString(); }

async function sha256hex(s: string) {
  const b = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function normUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    // youtu.be → youtube 正規化
    if (url.hostname === 'youtu.be') {
      const vid = url.pathname.replace('/', '');
      if (vid) return `https://www.youtube.com/watch?v=${vid}`;
    }
    // m.youtube.com → www.youtube.com
    if (url.hostname === 'm.youtube.com') url.hostname = 'www.youtube.com';
    // Google News の元記事アンラップ
    if (url.hostname.endsWith('news.google.com')) {
      const orig = url.searchParams.get('url');
      if (orig) return normUrl(orig);
    }
    // AMP → 本体（単純除去）
    url.pathname = url.pathname.replace(/\/amp\/?$/, '/');
    // トラッキング系削除
    url.hash = '';
    const drop = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'];
    drop.forEach(k => url.searchParams.delete(k));
    return url.toString();
  } catch {
    return null;
  }
}

function domain(u: string) {
  try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
}

function parseDateToISODateOnly(input?: string | null): string | null {
  // YYYY-MM-DD を返す（JST起点の曖昧な日付も拾う）
  if (!input) return null;
  const iso = input.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const jp = input.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (jp) {
    const y = Number(jp[1]);
    const m = String(Number(jp[2])).padStart(2,'0');
    const d = String(Number(jp[3])).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const t = Date.parse(input);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return null;
}

function toUtcIso(dt: string | Date): string {
  const d = (dt instanceof Date) ? dt : new Date(dt);
  return d.toISOString();
}

function stripCDATA(s: string) { return s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim(); }
function decodeEntities(s: string) { return s.replace(/&amp;/g, '&'); }
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// -------------------------------
// Supabase REST
// -------------------------------
async function sbPost(env: Env, path: string, body: unknown, extra?: Record<string,string>) {
  const url = `${env.SUPABASE_URL}${path}`;
  const tryOnce = async () => fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates',
      ...extra
    },
    body: JSON.stringify(body)
  });
  let res = await tryOnce();
  if (res.status >= 500 || res.status === 429) {
    await new Promise(r => setTimeout(r, 300));
    res = await tryOnce();
  }
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`Supabase POST ${path} -> ${res.status}: ${t}`);
  }
  return res;
}

async function sbGet(env: Env, path: string) {
  const url = `${env.SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    },
    cf: { cacheTtl: 0 }
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`Supabase GET ${path} -> ${res.status}: ${t}`);
  }
  return res.json();
}

async function sbPatch(env: Env, path: string, body: unknown) {
  const url = `${env.SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`Supabase PATCH ${path} -> ${res.status}: ${t}`);
  }
}

async function logJob(env: Env, row: any) {
  try {
    // crawl_logs に存在する安全な列だけを送る（必要に応じて増減）
    const allow = new Set([
      'job','ok','started_at','finished_at',
      'error','total','inserted','updated','skipped',
      'processed','linked','created'
    ]);
    const safe: Record<string, any> = {};
    for (const k of Object.keys(row || {})) {
      if (allow.has(k) && row[k] !== undefined) safe[k] = row[k];
    }
    await sbPost(env, '/rest/v1/crawl_logs', [safe]);
  } catch (e) {
    console.error('logJob failed', e);
  }
}

// -------------------------------
// 解析ヘルパ
// -------------------------------
type FeedItem = {
  title: string;
  url: string;
  published_at?: string | null; // ISO8601(UTC)
  thumbnail_url?: string | null;
  source_name?: string | null;
  zoo_id?: string | null;
  species?: string | null;
};

function textBetween(xml: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}
function attrValue(xml: string, tag: string, attr: string) {
  const re = new RegExp(`<${tag}[^>]*${attr}\\s*=\\s*"(.*?)"[^>]*>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function parseRSS(xml: string): FeedItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    let title = stripCDATA(textBetween(b, 'title') || '');
    let link = decodeEntities(stripCDATA(attrValue(b, 'link', 'href') || textBetween(b, 'link') || textBetween(b, 'guid') || ''));
    const pubRaw = stripCDATA(textBetween(b, 'pubDate') || textBetween(b, 'updated') || textBetween(b, 'published') || '');
    const published_at = (pubRaw ? toUtcIso(pubRaw) : null);
    const thumb = attrValue(b, 'media:thumbnail', 'url') || attrValue(b, 'enclosure', 'url') || null;
    const finalUrl = normUrl(link || '');
    if (!finalUrl) continue;
    out.push({
      title,
      url: finalUrl,
      published_at,
      thumbnail_url: thumb,
      source_name: domain(finalUrl)
    });
  }
  return out;
}

// サイトHTMLのOGP抽出（タイトル・URL・og:image）
function parseSiteOG(html: string, fallbackUrl: string): FeedItem {
  const ogt = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] || '';
  const ogu = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i)?.[1] || fallbackUrl;
  const ogi = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] || '';
  const pub1 = html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i)?.[1] || '';
  const pub2 = html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || '';
  const pub = pub1 || pub2;
  const nurl = normUrl(ogu || fallbackUrl)!;
  return {
    title: (ogt || '').trim(),
    url: nurl,
    published_at: pub ? toUtcIso(pub) : null,
    thumbnail_url: ogi || null,
    source_name: domain(nurl)
  };
}

// -------------------------------
// イベント抽出ルール
// -------------------------------
const BABY_KEYWORDS = /(誕生|出産|赤ちゃん|赤仔|ベビー|生まれ|命名|名前に決定)/;

const SPECIES_MAP = new Map<string, string>([
  ["ジャイアントパンダ", "ジャイアントパンダ"],
  ["レッサーパンダ", "レッサーパンダ"],
  ["ホッキョクグマ", "ホッキョクグマ"],
  ["シロクマ", "ホッキョクグマ"],
  ["トラ", "トラ"],
  ["ライオン", "ライオン"],
  ["ゴリラ", "ゴリラ"],
  ["チンパンジー", "チンパンジー"],
  ["キリン", "キリン"],
  ["カバ", "カバ"],
  ["ゾウ", "ゾウ"],
  ["コツメカワウソ", "コツメカワウソ"],
  ["コアラ", "コアラ"],
  ["カンガルー", "カンガルー"],
  ["シマウマ", "シマウマ"],
  ["フラミンゴ", "フラミンゴ"],
]);

const NAME_PATTERNS: RegExp[] = [
  /命名[「『"](?!\s)(?<name>[^」』"\s]{1,12})[」』"]/,
  /名前[は：:\s]*[「『"]?(?<name>[^」』"\s]{1,12})[」』"]?/,
  /[「『"](?!\s)(?<name>[^」』"\s]{1,12})[」』"][にへ]?決定/,
  /赤ちゃん[「『"](?!\s)(?<name>[^」』"\s]{1,12})[」』"]/,
  /['"“”‘’](?<name>[^'"“”‘’\s]{1,12})['"“”‘’]/,
  /(?<![ぁ-んァ-ヴーa-zA-Z0-9])(?<name>[一-龯ぁ-んァ-ヴーA-Za-z]{2,8})(ちゃん|くん)(?![ぁ-んァ-ヴーA-Za-z0-9])/,
];

function extractBabyName(text: string): string | null {
  const t = (text || "").replace(/\s+/g, "");
  for (const re of NAME_PATTERNS) {
    const m = t.match(re);
    const name = m?.groups?.name;
    if (!name) continue;
    if (/赤ちゃん|命名|動画|shorts|まとめ|観察|様子/.test(name)) continue;
    if (/^[一-龯ぁ-んァ-ヴーA-Za-z]{1,12}$/.test(name)) return name;
  }
  return null;
}

function extractSpeciesAlias(title: string): { species?: string; alias?: string } {
  for (const [alias, canonical] of SPECIES_MAP) {
    if (title.includes(alias)) return { species: canonical, alias };
  }
  return {};
}

function decideBirthdayByAge(title: string, fallbackISO?: string | null): string | null {
  const m = title.match(/(?<m>\d{1,2})月(?<d>\d{1,2})日（(?<age>\d{1,3})日齢）/);
  if (!m?.groups) return null;
  const pub = fallbackISO ? new Date(fallbackISO) : null;
  const nowY = new Date().getFullYear();
  const refY = pub ? pub.getFullYear() : nowY;
  const ref = new Date(refY, Number(m.groups.m) - 1, Number(m.groups.d));
  const refDate = (pub && ref.getTime() > pub.getTime()) ? pub : ref;
  refDate.setDate(refDate.getDate() - Number(m.groups.age));
  return refDate.toISOString().slice(0, 10);
}

function ensureBabyName(givenName?: string | null, hint?: string | null) {
  if (givenName && givenName.trim()) return givenName.trim().slice(0, 100);
  if (hint) return `赤ちゃん（${hint}）`;
  return '赤ちゃん';
}

// -------------------------------
// zoo_id 推定（一覧をロード → タイトル/ドメインで推定）
// -------------------------------
type ZooIndex = {
  byHost: Map<string, string>; // hostname -> zoo_id
  names: Array<{ id: string; variants: string[] }>;
};

function stripParensAll(s: string) {
  // () / （） / [] / ［］ の括弧内を削除
  return s.replace(/[（(［\[][^）)\]］]*[）)\]］]/g, '').trim();
}
function normalizeForMatch(s: string) {
  // 空白・主要括弧・記号を除去（簡易）
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/[【】「」『』\[\]\(\)（）・、，,．。!！?？：:；;]/g, '')
    .toLowerCase();
}
function buildZooNameVariants(name: string): string[] {
  const v1 = normalizeForMatch(name);
  const v2 = normalizeForMatch(stripParensAll(name));
  const set = new Set([v1, v2]);
  return Array.from(set).filter(v => v.length >= 4);
}

async function loadZooIndex(env: Env): Promise<ZooIndex> {
  // 1) zoos から id, name, website
  const zoos = await sbGet(env, `/rest/v1/zoos?select=id,name,website`);
  // 2) sources(kind='site' かつ zoo_idあり) からドメイン→zoo_id
  const srcs = await sbGet(env, `/rest/v1/sources?select=url,zoo_id&kind=eq.site&zoo_id=not.is.null`);

  const byHost = new Map<string, string>();
  const names: Array<{ id: string; variants: string[] }> = [];

  for (const s of (srcs as any[] || [])) {
    const h = domain(s.url || '');
    if (h && s.zoo_id) byHost.set(h, s.zoo_id);
  }
  for (const z of (zoos as any[] || [])) {
    const h = domain(z.website || '');
    if (h && z.id) byHost.set(h, z.id); // 公式サイトのドメインもヒントに
    if (z?.name && z?.id) names.push({ id: z.id, variants: buildZooNameVariants(z.name) });
  }
  return { byHost, names };
}

function guessZooIdFromTitle(title: string, index: ZooIndex): string | null {
  const t = normalizeForMatch(title);
  let best: { id: string; score: number } | null = null;
  for (const entry of index.names) {
    for (const v of entry.variants) {
      if (!v) continue;
      if (t.includes(v)) {
        const score = v.length; // 長い一致ほど強い
        if (!best || score > best.score) best = { id: entry.id, score };
      }
    }
  }
  return best?.id || null;
}

function guessZooId(title: string, url: string, index: ZooIndex): string | null {
  const h = domain(url || '');
  if (h && index.byHost.has(h)) return index.byHost.get(h)!;
  return guessZooIdFromTitle(title || '', index);
}

// -------------------------------
// イベント保存（baby_events）
// -------------------------------
type BabyEventRow = {
  url: string;
  title: string | null;
  published_at: string | null; // ISO8601(UTC)
  thumbnail_url: string | null;
  zoo_id: string | null;
  species: string | null;
  source_id: string | null;
  source_kind: string | null; // 'site'|'press'|'rss'|'youtube'|'googlenews'|...
  signal_birth: boolean;
  signal_name: string | null;
  signal_age_days: number | null;
};

async function upsertBabyEvents(env: Env, rows: BabyEventRow[]) {
  if (!rows.length) return;
  // 同一URLを1リクエスト内で重複投入しない
  const byUrl = new Map<string, BabyEventRow>();
  for (const r of rows) {
    const u = normUrl(r.url);
    if (!u) continue;
    if (!byUrl.has(u)) byUrl.set(u, { ...r, url: u });
    // 2回目以降はマージしたければここで統合ロジックを入れる（今回は先勝ち）
  }
  const uniq = Array.from(byUrl.values());
  for (const part of chunk(uniq, MAX_UPSERT_CHUNK)) {
    await sbPost(env, '/rest/v1/baby_events?on_conflict=url', part);
  }
}

// -------------------------------
// NEWS ジョブ: RSS/Atom/GoogleNews → イベント化 + news_items へも保存
// -------------------------------
async function runNewsJob(env: Env) {
  const started = new Date();
  const sources = await sbGet(
    env,
    `/rest/v1/sources?select=*&enabled=eq.true&kind=in.(rss,youtube,googlenews)&order=last_checked.asc.nullsfirst&limit=${MAX_SOURCES_PER_RUN}`
  );

  const events: BabyEventRow[] = [];
  const processedIds: string[] = [];
  // URL -> news_row（同一URLは1つに）
  const newsMap = new Map<string, any>();

  let total = 0, skipped = 0;

  for (const s of sources as any[]) {
    try {
      if (s?.id) processedIds.push(s.id);

      const res = await fetch(s.url, { cf: { cacheTtl: 0 } });
      if (!res.ok) throw new Error(`fetch ${s.url} -> ${res.status}`);
      const xml = await res.text();
      const items = parseRSS(xml).slice(0, MAX_EVENTS_PER_SOURCE);
      total += items.length;

      for (const it of items) {
        const url = normUrl(it.url);
        if (!url) continue;

        const title = it.title || '';
        const { species, alias } = extractSpeciesAlias(title || '');
        const givenName = extractBabyName(title || '');
        const ageMatch = title.match(/(\d{1,3})日齢/);
        const signal_age_days = ageMatch ? Number(ageMatch[1]) : null;

        // 1) baby_events（URL重複は upsert側でも弾くが、ここではそのまま貯める）
        events.push({
          url,
          title,
          published_at: it.published_at ? toUtcIso(it.published_at) : null,
          thumbnail_url: it.thumbnail_url || null,
          zoo_id: s.zoo_id || null,
          species: species || alias || null,
          source_id: s.id || null,
          source_kind: s.kind || null,
          signal_birth: BABY_KEYWORDS.test(title),
          signal_name: givenName || null,
          signal_age_days
        });

        // 2) news_items（URLで Map 去重）
        const candidate = {
          title: title?.slice(0, 300) || null,
          url,
          published_at: it.published_at ? toUtcIso(it.published_at) : null,
          source_name: it.source_name || domain(url) || null,
          source_url: s.url || null,
          thumbnail_url: it.thumbnail_url || null,
          baby_id: null,
          zoo_id: s.zoo_id || null,
        };
        if (!newsMap.has(url)) {
          newsMap.set(url, candidate);
        } else {
          // 既存とマージ（null を埋める程度の軽い統合）
          const prev = newsMap.get(url);
          newsMap.set(url, {
            ...prev,
            title: prev.title || candidate.title,
            published_at: prev.published_at || candidate.published_at,
            source_name: prev.source_name || candidate.source_name,
            source_url: prev.source_url || candidate.source_url,
            thumbnail_url: prev.thumbnail_url || candidate.thumbnail_url,
            zoo_id: prev.zoo_id || candidate.zoo_id,
          });
        }
      }
    } catch (e) {
      console.error('news source failed', s?.url, e);
      skipped++;
    }
  }

  try {
    // events を upsert（関数内でURL去重済み）
    await upsertBabyEvents(env, events);

    // news_items を upsert（URL去重済み）
    const newsRows = Array.from(newsMap.values());
    for (const part of chunk(newsRows, 500)) {
      if (part.length) {
        await sbPost(
          env,
          '/rest/v1/news_items?on_conflict=url',
          part,
          { 'Prefer': 'resolution=merge-duplicates' }
        );
      }
    }

    // last_checked をまとめて更新
    if (processedIds.length) {
      await sbPatch(env, `/rest/v1/sources?id=in.(${processedIds.join(',')})`, { last_checked: nowIso() });
    }
  } catch (e) {
    console.error('news upsert failed', e);
  }

  console.log('NEWS->(EVENTS & NEWS_ITEMS) STATS', {
    scanned: total, events_saved: events.length, news_saved: newsMap.size, skipped,
    sources: Array.isArray(sources) ? (sources as any[]).length : 0
  });

  // ★ ログは安全な列のみ
  await logJob(env, {
    job: 'news->events+news_items', ok: true, started_at: started, finished_at: new Date(),
    total,
    inserted: newsMap.size,  // 参考値（crawl_logs に inserted があれば入る）
    skipped
  });
}

// -------------------------------
// SITE ジョブ: 公式サイトの一覧ページ → 記事 → イベント化（出生系事前フィルタ）
// -------------------------------
function extractLinksFromListingWithText(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const hrefRaw = m[1];
    if (!hrefRaw) continue;
    let abs: string | null = null;
    try { abs = new URL(hrefRaw, baseUrl).toString(); } catch { abs = null; }
    if (!abs) continue;
    const text = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ href: abs, text });
  }
  // 同一ドメインに限定 & hrefで重複除去
  const baseHost = domain(baseUrl);
  const seen = new Set<string>();
  const filtered: Array<{ href: string; text: string }> = [];
  for (const a of out) {
    if (domain(a.href) !== baseHost) continue;
    if (seen.has(a.href)) continue;
    seen.add(a.href);
    filtered.push(a);
  }
  return filtered;
}

async function runSiteNewsJob(env: Env) {
  const started = new Date();
  const sources = await sbGet(
    env,
    `/rest/v1/sources?select=*&enabled=eq.true&kind=eq.site&order=last_checked.asc.nullsfirst&limit=${MAX_SITE_SOURCES_PER_RUN}`
  );

  const events: BabyEventRow[] = [];
  const processedIds: string[] = [];
  let total = 0, skipped = 0;

  for (const s of sources as any[]) {
    try {
      if (s?.id) processedIds.push(s.id);
      const res = await fetch(s.url, { headers: { 'Accept': 'text/html' }, cf: { cacheTtl: 0 } });
      if (!res.ok) throw new Error(`fetch listing ${s.url} -> ${res.status}`);
      const listingHtml = await res.text();

      // a[href] + 表示テキスト抽出
      const links = extractLinksFromListingWithText(listingHtml, s.url);

      // 出生系キーワードで事前フィルタ → 多すぎる場合は cap
      let pick = links.filter(a => BIRTH_KW.test(a.text || ''));
      if (pick.length === 0) {
        // 0件のときは上から少数だけ拾う（サイト構造が特殊な園対策）
        pick = links.slice(0, Math.min(3, SITE_DETAIL_FETCH_LIMIT));
      } else {
        pick = pick.slice(0, SITE_DETAIL_FETCH_LIMIT);
      }

      // 記事詳細から OGP 等を抽出してイベント化
      for (const a of pick) {
        try {
          const art = await fetch(a.href, { headers: { 'Accept': 'text/html' }, cf: { cacheTtl: 0 } });
          if (!art.ok) continue;
          const html = await art.text();
          const item = parseSiteOG(html, a.href);
          total++;

          const url = normUrl(item.url);
          if (!url) continue;

          const title = item.title || a.text || '';
          const { species, alias } = extractSpeciesAlias(title);
          const givenName = extractBabyName(title);
          const ageMatch = title.match(/(\d{1,3})日齢/);
          const signal_age_days = ageMatch ? Number(ageMatch[1]) : null;

          events.push({
            url,
            title,
            published_at: item.published_at ? toUtcIso(item.published_at) : null,
            thumbnail_url: item.thumbnail_url || null,
            zoo_id: s.zoo_id || null,            // 公式サイトならsourcesに登録済みのことが多い
            species: species || alias || null,
            source_id: s.id || null,
            source_kind: s.kind || 'site',
            signal_birth: BIRTH_KW.test(title),
            signal_name: givenName || null,
            signal_age_days
          });
        } catch (e) {
          console.warn('site article fetch failed', a.href, e);
        }
      }
    } catch (e) {
      console.error('site listing failed', s?.url, e);
      skipped++;
    }
  }

  try {
    await upsertBabyEvents(env, events);
    if (processedIds.length) {
      await sbPatch(env, `/rest/v1/sources?id=in.(${processedIds.join(',')})`, { last_checked: nowIso() });
    }
  } catch (e) {
    console.error('site upsert failed', e);
  }

  console.log('SITE->EVENTS STATS (filtered)', {
    total, events: events.length, skipped, sources: (sources as any[]).length, perSiteLimit: SITE_DETAIL_FETCH_LIMIT
  });
  await logJob(env, {
    job: 'site->events(filtered)', ok: true, started_at: started, finished_at: new Date(),
    total, events: events.length, skipped
  });
}

// -------------------------------
// RESOLVE ジョブ: イベント → babies 確定/更新（バッチ化 + zoo_id 推定）
// -------------------------------
const MATCH_DAYS = 10;          // birthday ±k日
const CREATE_THRESHOLD = 3;     // babies新規作成の最小スコア

type EventForResolve = {
  id: string;
  url: string;
  title: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
  zoo_id: string | null;
  species: string | null;
  source_kind: string | null;
  signal_birth: boolean;
  signal_name: string | null;
  signal_age_days: number | null;
};

function scoreForCreate(ev: EventForResolve): number {
  let score = 0;
  if (ev.source_kind === 'site' || ev.source_kind === 'press') score += 2;
  else if (ev.source_kind === 'youtube') score += 1;
  if (ev.signal_birth) score += 2;
  if (ev.zoo_id) score += 1;
  if (ev.signal_age_days !== null) score += 1;
  else if (parseDateToISODateOnly(ev.title || '')) score += 1;
  return score;
}

function inferBirthday(ev: EventForResolve): string | null {
  const byAge = ev.title ? decideBirthdayByAge(ev.title, ev.published_at || null) : null;
  const byTitle = ev.title ? parseDateToISODateOnly(ev.title) : null;
  if (byAge) return byAge;
  if (byTitle) return byTitle;
  if (ev.published_at) return (ev.published_at || '').slice(0, 10);
  return null;
}

async function resolveBabyEntitiesJob(env: Env) {
  const started = new Date();

  // 未処理イベントを少量だけ取得（件数制限）
  const events: EventForResolve[] = await sbGet(
    env,
    `/rest/v1/baby_events` +
    `?select=id,url,title,published_at,thumbnail_url,zoo_id,species,source_kind,signal_birth,signal_name,signal_age_days` +
    `&processed_at=is.null` +
    `&order=published_at.desc.nullslast` +
    `&limit=${RESOLVE_BATCH_LIMIT}`
  );

  if (!Array.isArray(events) || events.length === 0) {
    await logJob(env, { job: 'resolve_babies', ok: true, started_at: started, finished_at: new Date(), processed: 0, linked: 0, created: 0 });
    return;
  }

  // ここで一度だけ zoo インデックスを読み込む（SELECT×2回）
  const zooIndex = await loadZooIndex(env);

  let linked = 0, created = 0, processed = 0;

  const processedIds: string[] = [];         // 後でまとめて processed_at を付ける
  const linkRows: Array<{baby_id: string, event_id: string}> = []; // 後でまとめて POST

  for (const ev of events) {
    processed++;
    processedIds.push(ev.id);

    const bday = inferBirthday(ev);

    // ev.zoo_id が無ければ title/url から推定
    const guessedZooId = (!ev.zoo_id)
      ? guessZooId(ev.title || '', ev.url || '', zooIndex)
      : null;
    const zooIdForEvent = ev.zoo_id || guessedZooId || null;

    // 既存 babies へ一致探索（zoo_id, species, birthday±k日）
    let targetBabyId: string | null = null;

    if (zooIdForEvent && ev.species && bday) {
      const min = new Date(bday); min.setDate(min.getDate() - MATCH_DAYS);
      const max = new Date(bday); max.setDate(max.getDate() + MATCH_DAYS);
      const q =
        `/rest/v1/babies?select=id` +
        `&zoo_id=eq.${zooIdForEvent}` +
        `&species=eq.${encodeURIComponent(ev.species)}` +
        `&birthday=gte.${min.toISOString().slice(0,10)}` +
        `&birthday=lte.${max.toISOString().slice(0,10)}` +
        `&limit=1`;
      const hit = await sbGet(env, q);
      if (Array.isArray(hit) && hit.length) targetBabyId = hit[0].id as string;
    }

    const canCreate = scoreForCreate(ev) >= CREATE_THRESHOLD;

    if (targetBabyId) {
      linkRows.push({ baby_id: targetBabyId, event_id: ev.id });
      linked++;
      continue;
    }

    if (canCreate) {
      // babies 新規作成（個体IDが必要なのでここは単発 POST）
      const nameHint = ev.species || '';
      const displayName = ensureBabyName(ev.signal_name, nameHint);
      const row = {
        name: displayName,
        species: ev.species,
        birthday: bday,
        thumbnail_url: ev.thumbnail_url,
        zoo_id: zooIdForEvent, // ← 推定結果を使用（null あり得る）
      };
      const res = await sbPost(env, '/rest/v1/babies', [row], { 'Prefer': 'return=representation' });
      const createdRows = await res.json().catch(()=>[]) as any[];
      const newId = createdRows?.[0]?.id as string | undefined;
      if (newId) {
        linkRows.push({ baby_id: newId, event_id: ev.id });
        created++;
      }
    }
    // 一致せず閾値未満: 何もしない（候補は将来拡張）
  }

  // まとめてリンク upsert
  for (const part of chunk(linkRows, LINKS_CHUNK)) {
    if (part.length) await sbPost(env, '/rest/v1/baby_links', part);
  }

  // まとめて processed_at を付与
  const now = nowIso();
  for (const part of chunk(processedIds, PATCH_CHUNK)) {
    const inList = part.join(',');
    await sbPatch(env, `/rest/v1/baby_events?id=in.(${inList})`, { processed_at: now });
  }

  console.log('RESOLVE STATS (batched)', { processed, linked, created });
  await logJob(env, {
    job: 'resolve_babies', ok: true, started_at: started, finished_at: new Date(),
    processed, linked, created
  });
}

// -------------------------------
// 収集ジョブ: 動物園（Wikipedia）※現行維持
// -------------------------------
async function runZoosJob(env: Env) {
  const started = new Date();
  let total = 0, inserted = 0, skipped = 0;

  try {
    const api = 'https://ja.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:%E6%97%A5%E6%9C%AC%E3%81%AE%E5%8B%95%E7%89%A9%E5%9C%92&cmlimit=500&format=json&origin=*';
    const res = await fetch(api, {
      headers: {
        'User-Agent': 'BabyAnimalsCrawler/1.0 (+https://babyanimals.pages; contact: co.az.mu@gmail.com)',
        'Accept': 'application/json'
      },
      cf: { cacheTtl: 3600 }
    });
    if (!res.ok) throw new Error(`wikipedia -> ${res.status}`);
    const json = await res.json();
    const members: any[] = json?.query?.categorymembers || [];
    total = members.length;

    const nameSet = new Set<string>();
    for (const m of members) {
      const clean = (m?.title || '').replace(/\s*\(.*?\)\s*/g, '').trim();
      if (clean) nameSet.add(clean);
    }

    const rows = Array.from(nameSet).map(name => ({ name }));
    for (const part of chunk(rows, 500)) {
      if (part.length) await sbPost(env, '/rest/v1/zoos?on_conflict=name', part);
      inserted += part.length;
    }

    console.log('ZOOS JOB STATS', { total, uniqueRows: rows.length });
    await logJob(env, { job: 'zoos', ok: true, started_at: started, finished_at: new Date(), total, inserted, skipped });
  } catch (e) {
    await logJob(env, { job: 'zoos', ok: false, started_at: started, finished_at: new Date(), error: String(e) });
    throw e;
  }
}

// -------------------------------
// スケジュール・エントリポイント
// -------------------------------
export default {
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    try {
      // 例:
      //  0 * * * *    -> ニュース/RSS/YouTube/GoogleNews → イベント化
      //  5 * * * *    -> 公式サイト一覧 → 記事抽出 → イベント化
      //  30 18 * * *  -> 動物園一覧
      //  10 * * * *   -> イベント解決（babies確定/更新）
      if (event.cron === '0 * * * *') {
        await runNewsJob(env);
      } else if (event.cron === '5 * * * *') {
        await runSiteNewsJob(env);
      } else if (event.cron === '30 18 * * *') {
        await runZoosJob(env);
      } else if (event.cron === '10 * * * *') {
        await resolveBabyEntitiesJob(env);
      } else {
        console.log('unknown cron', event.cron);
      }
    } catch (e) {
      await logJob(env, { job: 'unknown', ok: false, error: String(e), started_at: new Date(), finished_at: new Date() });
      throw e;
    }
  },

  // 手動実行: /run?job=news|site|zoos|resolve&token=XXXX
  async fetch(req: Request, env: Env) {
    const { searchParams, pathname } = new URL(req.url);
    if (pathname !== '/run') return new Response('ok');

    const token = searchParams.get('token') || '';
    const job = (searchParams.get('job') || '').toLowerCase();
    const ok = Boolean(token && env.RUN_TOKEN && token === env.RUN_TOKEN);
    if (!ok) return new Response('forbidden', { status: 403 });

    const started = new Date();
    try {
      if (job === 'news')         await runNewsJob(env);
      else if (job === 'site')    await runSiteNewsJob(env);
      else if (job === 'zoos')    await runZoosJob(env);
      else if (job === 'resolve') await resolveBabyEntitiesJob(env);
      else return new Response(JSON.stringify({ ok:false, error:'bad job', job }), { status:400, headers:{'content-type':'application/json'} });

      await logJob(env, { job, ok: true, started_at: started, finished_at: new Date() });
      return new Response(JSON.stringify({ ok: true, job }), { headers: { 'content-type': 'application/json' } });
    } catch (e) {
      await logJob(env, { job, ok: false, error: String(e), started_at: started, finished_at: new Date() });
      return new Response(JSON.stringify({ ok: false, job, error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  }
};
