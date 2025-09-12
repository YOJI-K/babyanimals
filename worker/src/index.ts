// worker/src/index.ts
// Baby Animals - Auto Crawl Worker (news hourly / zoos daily / babies daily)
// ランタイム: Cloudflare Workers (Service bindings: SUPABASE_URL, SUPABASE_SERVICE_ROLE)

export interface Env {
  SUPABASE_URL: string;                // 例: https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE: string;       // Supabase Service Role key（Secret）
  RUN_TOKEN?: string;                  // GET /run 用の手動実行トークン（オプショナル）
}

// -------------------------------
// 小さな共通ユーティリティ
// -------------------------------
const JP_TZ = 'Asia/Tokyo';
// 1回の実行で処理する news ソース最大数（Cloudflare Workers の subrequests 制限対策）
const MAX_SOURCES_PER_RUN = 25;
// 1回の実行で処理する babies ソース最大数（Cloudflare Workers の subrequests 制限対策）
const MAX_BABY_SOURCES_PER_RUN = 25;

function nowIso() {
  return new Date().toISOString();
}

async function sha256hex(s: string) {
  const b = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function normUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    url.hash = '';
    // 追跡系クエリを削除（重複抑止）
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
// Google News のリンクから元記事URLを取り出す
function unwrapGoogleNews(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.hostname.endsWith('news.google.com')) {
      // 多くの場合、元記事URLは ?url= に入っている
      const orig = url.searchParams.get('url');
      if (orig) return normUrl(orig);
    }
    return normUrl(u);
  } catch {
    return normUrl(u || '');
  }
}
// YYYY-MM-DD を返す（日本語日付にも対応）
function parseDateToISO(input?: string | null): string | null {
  if (!input) return null;
  // ISO っぽい
  const iso = input.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 2025年9月3日
  const jp = input.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (jp) {
    const y = Number(jp[1]);
    const m = String(Number(jp[2])).padStart(2,'0');
    const d = String(Number(jp[3])).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  // 9月3日（年省略は今年とみなす）
  const jp2 = input.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (jp2) {
    const y = new Date().getFullYear();
    const m = String(Number(jp2[1])).padStart(2,'0');
    const d = String(Number(jp2[2])).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  // pubDateっぽい文字列
  const t = Date.parse(input);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return null;
}

// CDATA/エンティティ処理（RSSの堅牢化）
function stripCDATA(s: string) {
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim();
}
function decodeEntities(s: string) {
  // URLで致命になりやすい &amp; のみ最低限
  return s.replace(/&amp;/g, '&');
}
// 配列ユーティリティ：チャンク分割
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
  const res = await fetch(url, {
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
    await sbPost(env, '/rest/v1/crawl_logs', [row]);
  } catch (e) {
    console.error('logJob failed', e);
  }
}

// -------------------------------
/** RSS/Atom/YouTube/GoogleNews 最小パーサ
 * 依存を増やさないために簡易実装（高精度は将来差し替え可）
 */
type FeedItem = {
  title: string;
  url: string;
  published_at?: string | null;
  thumbnail_url?: string | null;
  source_name?: string | null;
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
  // item または entry を抽出（雑に）
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  const out: FeedItem[] = [];

  for (const b of blocks) {
    // title
    let title = textBetween(b, 'title') || '';
    title = stripCDATA(title);

    // link: Atomの <link href="..."> を優先 → 無ければ <link>…</link> → <guid>
    let link = attrValue(b, 'link', 'href') || textBetween(b, 'link') || textBetween(b, 'guid') || '';
    link = decodeEntities(stripCDATA(link));

    // pubDate / updated / published を順に評価（YouTube Atomは <published>）
    const pubRaw = textBetween(b, 'pubDate') || textBetween(b, 'updated') || textBetween(b, 'published') || '';
    const published_at = parseDateToISO(stripCDATA(pubRaw)) || null;

    // media:thumbnail / enclosure
    const thumb = attrValue(b, 'media:thumbnail', 'url') ||
                  attrValue(b, 'enclosure', 'url') ||
                  null;

    // Google News の場合は元記事URLを優先（?url= が無い型もあるため最後に正規化）
    const finalUrl = unwrapGoogleNews(link || '');
    const norm = normUrl(finalUrl || '');

    if (norm) {
      out.push({
        title,
        url: norm,
        published_at,
        thumbnail_url: thumb,
        source_name: domain(norm)
      });
    }
  }
  return out;
}

// -------------------------------
// 収集ジョブ: ニュース（毎時）
// -------------------------------
async function runNewsJob(env: Env) {
  const started = new Date();
  let counters = { total: 0, inserted: 0, updated: 0, skipped: 0 };

  // 有効なソースを last_checked 昇順で最大 N 件だけ取得（上限回避）
  const sources = await sbGet(
    env,
    `/rest/v1/sources?select=*&enabled=eq.true&kind=in.(rss,youtube,googlenews)&order=last_checked.asc.nullsfirst&limit=${MAX_SOURCES_PER_RUN}`
  );

  // 一括書き込み用のバッファ
  const fpSet = new Set<string>();     // fingerprints（重複除去）
  const newsRows: any[] = [];          // news_items
  const processedIds: string[] = [];   // 今回処理した source.id

  for (const s of sources as any[]) {
    try {
      if (s?.id) processedIds.push(s.id); // ローテーション対象として記録

      const res = await fetch(s.url, { cf: { cacheTtl: 0 } });
      if (!res.ok) throw new Error(`fetch ${s.url} -> ${res.status}`);

      const xml = await res.text();
      const items = parseRSS(xml);
      counters.total += items.length;

      // ここでは貯めるだけ（Supabase へは後で一括送信）
      for (const it of items) {
        const u = normUrl(it.url);
        if (!u) continue;
        const fp = await sha256hex(u);
        fpSet.add(fp);

        newsRows.push({
          title: it.title?.slice(0, 300) || null,
          url: u,
          published_at: it.published_at,
          thumbnail_url: it.thumbnail_url,
          source_name: it.source_name,
          source_url: s.url,
          source_id: s.id
        });
      }
    } catch (e) {
      console.error('news source failed', s.url, e);
      counters.skipped++;
    }
  }

  // ---- ここから一括書き込み ----
  try {
    // 1) fingerprints をチャンクで upsert
    const fpRows = Array.from(fpSet).map(fp => ({ fp, kind: 'news' }));
    for (const part of chunk(fpRows, 1000)) {
      if (part.length) await sbPost(env, '/rest/v1/fingerprints?on_conflict=fp', part);
    }

    // 2) news_items(url unique) をチャンクで upsert
    for (const part of chunk(newsRows, 500)) {
      if (part.length) await sbPost(env, '/rest/v1/news_items?on_conflict=url', part);
      counters.inserted += part.length; // 重複はignoreされるため概算
    }

    // 3) 今回処理した source のみ last_checked を一括更新（1回）
    if (processedIds.length) {
      const inList = processedIds.join(',');
      await sbPatch(env, `/rest/v1/sources?id=in.(${inList})`, { last_checked: nowIso() });
    }
  } catch (e) {
    console.error('bulk upsert failed', e);
    // 失敗してもログは残す
  }

  // 観測用の軽量ログ
  console.log('NEWS JOB STATS', {
    total: counters.total,
    newsRows: newsRows.length,
    fpSize: fpSet.size,
    sources: Array.isArray(sources) ? (sources as any[]).length : 0
  });

  await logJob(env, {
    job: 'news', ok: true, started_at: started, finished_at: new Date(),
    total: counters.total, inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped
  });
}


// -------------------------------
// 収集ジョブ: 動物園（毎日）
// Wikipedia カテゴリから名称を取得 → zoos に upsert（name だけ）
// -------------------------------
async function runZoosJob(env: Env) {
  const started = new Date();
  let counters = { total: 0, inserted: 0, updated: 0, skipped: 0 };

  try {
    const api = 'https://ja.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:%E6%97%A5%E6%9C%AC%E3%81%AE%E5%8B%95%E7%89%A9%E5%9C%92&cmlimit=500&format=json&origin=*';
    const res = await fetch(api, { cf: { cacheTtl: 3600 } });
    if (!res.ok) throw new Error(`wikipedia -> ${res.status}`);
    const json = await res.json();
    const members: any[] = json?.query?.categorymembers || [];
    counters.total = members.length;

    const rows = members
      .map(m => (m?.title || '').replace(/\s*\(.*?\)\s*/g, '').trim())
      .filter(Boolean)
      .map(name => ({ name }));

    if (rows.length) {
      // zoos: name だけ upsert（将来は公式URL等も突合）
      await sbPost(env, '/rest/v1/zoos?on_conflict=name', rows);
      counters.inserted = rows.length;
    }

    await logJob(env, {
      job: 'zoos', ok: true, started_at: started, finished_at: new Date(),
      total: counters.total, inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped
    });
  } catch (e) {
    await logJob(env, { job: 'zoos', ok: false, started_at: started, finished_at: new Date(), error: String(e) });
    throw e;
  }
}

// -------------------------------
// 収集ジョブ: 赤ちゃん（毎日）
// ルールベースでタイトル/説明から誕生を推定 → babies に upsert（暫定）
// -------------------------------
const BABY_KEYWORDS = /(誕生|出産|赤ちゃん|赤仔|ベビー|生まれ)/;
const SPECIES_HINTS = [
  'ジャイアントパンダ','レッサーパンダ','ホッキョクグマ',
  'トラ','ライオン','ゴリラ','チンパンジー','キリン','カバ','ゾウ','シロクマ',
  'コツメカワウソ','コアラ','カンガルー','シマウマ','フラミンゴ'
];

async function runBabiesJob(env: Env) {
  const started = new Date();
  let counters = { total: 0, inserted: 0, updated: 0, skipped: 0 };

  try {
    // 有効なソースを last_checked 昇順で最大 N 件だけ取得（上限回避）
    const sources = await sbGet(
      env,
      `/rest/v1/sources?select=*&enabled=eq.true&kind=in.(rss,youtube,site)&order=last_checked.asc.nullsfirst&limit=${MAX_BABY_SOURCES_PER_RUN}`
    );

    // 一括書き込み用バッファ
    const fpSet = new Set<string>();     // fingerprints（重複除去, kind='baby'）
    const babyRows: any[] = [];          // babies テーブルへの upsert 行
    const processedIds: string[] = [];   // 今回処理した source.id（last_checked 更新用）

    for (const s of sources as any[]) {
      try {
        if (s?.id) processedIds.push(s.id); // ローテーション対象として記録

        const res = await fetch(s.url, { cf: { cacheTtl: 0 } });
        if (!res.ok) throw new Error(`fetch ${s.url} -> ${res.status}`);

        let candidates: FeedItem[] = [];

        if (s.kind === 'site') {
          // OGP を拾って1件だけ評価
          const html = await res.text();
          const ogt = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] || '';
          const ogd = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1] || '';
          const ogu = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i)?.[1] || s.url;
          const title = (ogt || '').trim();
          const url = normUrl(ogu || s.url)!;
          const pub = parseDateToISO(ogd) || null; // 説明に日付があれば
          candidates = [{ title, url, published_at: pub, thumbnail_url: null, source_name: domain(url) }];
        } else {
          const xml = await res.text();
          candidates = parseRSS(xml);    // YouTube/Atom も OK（published 対応済み）
        }

        counters.total += candidates.length;

        // ルール判定
        const approve = candidates.filter(it => {
          const text = `${it.title || ''}`;
          return BABY_KEYWORDS.test(text);
        });

        if (!approve.length) {
          counters.skipped++;
          continue;
        }

        for (const it of approve) {
          const u = normUrl(it.url);
          if (!u) continue;

          const fp = await sha256hex(u);
          fpSet.add(fp);

          const hint = SPECIES_HINTS.find(sp => (it.title || '').includes(sp)) || null;
          const bday = parseDateToISO(it.title) || it.published_at || null;

          babyRows.push({
            // name はページ依存なので未知（将来強化）
            name: ensureBabyName(it.title, hint),
            species: hint,
            birthday: bday,
            thumbnail_url: it.thumbnail_url,
            zoo_id: s.zoo_id || null,
          });
        }

      } catch (e) {
        console.error('babies source failed', s.url, e);
        counters.skipped++;
      }
    }

    // ---- ここから一括書き込み ----
    try {
      // 1) fingerprints（kind='baby'）をチャンクで upsert
      const fpRows = Array.from(fpSet).map(fp => ({ fp, kind: 'baby' }));
      for (const part of chunk(fpRows, 1000)) {
        if (part.length) await sbPost(env, '/rest/v1/fingerprints?on_conflict=fp', part);
      }

      // 2) babies をチャンクで upsert
      for (const part of chunk(babyRows, 500)) {
        if (part.length) await sbPost(env, '/rest/v1/babies', part);
        counters.inserted += part.length; // 重複があっても概算でOK
      }
      // 個体名が不明でもNOT NULLを満たすためのフォールバック
      function ensureBabyName(title?: string | null, hint?: string | null) {
        const t = (title || '').trim();
        if (t) return t.slice(0, 100); // タイトルを最大100文字で流用
        if (hint) return `赤ちゃん（${hint}）`;
        return '赤ちゃん';
        }
      // 3) 今回処理した source のみ last_checked を一括更新（1回）
      if (processedIds.length) {
        const inList = processedIds.join(',');
        await sbPatch(env, `/rest/v1/sources?id=in.(${inList})`, { last_checked: nowIso() });
      }
    } catch (e) {
      console.error('babies bulk upsert failed', e);
      // 失敗しても logJob は残す
    }

    // 観測用の軽量ログ
    console.log('BABIES JOB STATS', {
      total: counters.total,
      babyRows: babyRows.length,
      fpSize: fpSet.size,
      sources: Array.isArray(sources) ? (sources as any[]).length : 0
    });

    await logJob(env, {
      job: 'babies', ok: true, started_at: started, finished_at: new Date(),
      total: counters.total, inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped
    });

  } catch (e) {
    await logJob(env, { job: 'babies', ok: false, started_at: started, finished_at: new Date(), error: String(e) });
    throw e;
  }
}
// -------------------------------
// スケジュール・エントリポイント
// -------------------------------
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    try {
      if (event.cron === '0 * * * *') {
        await runNewsJob(env);
      } else if (event.cron === '15 18 * * *') {
        await runZoosJob(env);
      } else if (event.cron === '30 18 * * *') {
        await runBabiesJob(env);
      } else {
        console.log('unknown cron', event.cron);
      }
    } catch (e) {
      await logJob(env, { job: 'unknown', ok: false, error: String(e), started_at: new Date(), finished_at: new Date() });
      throw e;
    }
  },

  // ★ 追加：GET /run?job=news|zoos|babies&token=XXXX で手動実行
  async fetch(req: Request, env: Env) {
    const { searchParams, pathname } = new URL(req.url);
    if (pathname === '/run') {
      const token = searchParams.get('token') || '';
      const job = (searchParams.get('job') || '').toLowerCase();
      // Secret で保護（wrangler secret put RUN_TOKEN で設定）
      const ok = Boolean(token && env.RUN_TOKEN && token === env.RUN_TOKEN);
      if (!ok) return new Response('forbidden', { status: 403 });

      if (job === 'news')      { await runNewsJob(env); }
      else if (job === 'zoos') { await runZoosJob(env); }
      else if (job === 'babies'){ await runBabiesJob(env); }
      else return new Response('bad job', { status: 400 });

      return new Response(JSON.stringify({ ok: true, job }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('ok');
  }
};
