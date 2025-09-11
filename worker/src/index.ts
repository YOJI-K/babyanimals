// worker/src/index.ts
// Baby Animals - Auto Crawl Worker (news hourly / zoos daily / babies daily)
// ランタイム: Cloudflare Workers (Service bindings: SUPABASE_URL, SUPABASE_SERVICE_ROLE)

export interface Env {
  SUPABASE_URL: string;                // 例: https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE: string;       // Supabase Service Role key（Secret）
}

// -------------------------------
// 小さな共通ユーティリティ
// -------------------------------
const JP_TZ = 'Asia/Tokyo';

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
    return url.toString();
  } catch {
    return null;
  }
}

function domain(u: string) {
  try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; }
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
    title = title.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();

    // link
    let url = textBetween(b, 'link');
    // Atom 形式 <link href="...">
    if (!url) url = attrValue(b, 'link', 'href');

    // guid がURLの時も
    if (!url) url = textBetween(b, 'guid');
    url = normUrl(url || '');

    // pubDate / updated
    const pub = textBetween(b, 'pubDate') || textBetween(b, 'updated');
    const published_at = parseDateToISO(pub || '') || null;

    // media:thumbnail or enclosure
    const thumb = attrValue(b, 'media:thumbnail', 'url') ||
                  attrValue(b, 'enclosure', 'url') ||
                  null;

    if (url) {
      out.push({
        title, url,
        published_at,
        thumbnail_url: thumb,
        source_name: domain(url)
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

  // 有効なソースを取得
  const sources = await sbGet(env, '/rest/v1/sources?select=*&enabled=eq.true&kind=in.(rss,youtube,googlenews)');

  for (const s of sources as any[]) {
    try {
      const res = await fetch(s.url, { cf: { cacheTtl: 0 } });
      if (!res.ok) throw new Error(`fetch ${s.url} -> ${res.status}`);
      const xml = await res.text();
      const items = parseRSS(xml);

      counters.total += items.length;

      // fingerprints で重複ガード → news_items upsert
      const rows = [];
      for (const it of items) {
        const u = normUrl(it.url);
        if (!u) continue;
        const fp = await sha256hex(u);
        // fingerprints に記録（重複は無視）
        await sbPost(env, '/rest/v1/fingerprints?on_conflict=fp', [{ fp, kind: 'news' }]);

        rows.push({
          title: it.title?.slice(0, 300) || null,
          url: u,
          published_at: it.published_at,
          thumbnail_url: it.thumbnail_url,
          source_name: it.source_name,
          source_id: s.id
        });
      }

      if (rows.length) {
        // news_items(url unique) に upsert
        await sbPost(env, '/rest/v1/news_items?on_conflict=url', rows);
        // 挿入数は厳密に取れないので概算（重複はignoreされる）
        counters.inserted += rows.length;
      }
      // 最終チェック時間更新
      await sbPost(env, '/rest/v1/sources?id=eq.' + s.id, [{ last_checked: nowIso() }], {
        'Prefer': 'resolution=merge-duplicates'
      });

    } catch (e) {
      console.error('news source failed', s.url, e);
      counters.skipped++;
    }
  }

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
    // RSS/YouTube/Site から候補抽出（site は OGP のみ参照）
    const sources = await sbGet(env, '/rest/v1/sources?select=*&enabled=eq.true&kind=in.(rss,youtube,site)');

    for (const s of sources as any[]) {
      try {
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
          candidates = parseRSS(xml);
        }

        counters.total += candidates.length;

        // ルール判定
        const approve = candidates.filter(it => {
          const text = `${it.title || ''}`; // 説明は最小で未使用
          return BABY_KEYWORDS.test(text);
        });

        if (!approve.length) {
          counters.skipped++;
          continue;
        }

        // babies テーブルに upsert（name は未知なら null、species はヒント一致、birthday は日付抽出）
        const upserts = [];
        for (const it of approve) {
          const u = normUrl(it.url);
          if (!u) continue;

          const fp = await sha256hex(u);
          await sbPost(env, '/rest/v1/fingerprints?on_conflict=fp', [{ fp, kind: 'baby' }]);

          const hint = SPECIES_HINTS.find(sp => (it.title || '').includes(sp)) || null;
          const bday = parseDateToISO(it.title) || it.published_at || null;

          upserts.push({
            // name はページに依存するので未知扱い（将来強化）
            name: null,
            species: hint,
            birthday: bday,
            thumbnail_url: it.thumbnail_url,
            zoo_id: s.zoo_id || null,
            // 参考のため news_items にも残っているはず（URLユニーク）
          });
        }

        if (upserts.length) {
          await sbPost(env, '/rest/v1/babies', upserts);
          counters.inserted += upserts.length;
        }

      } catch (e) {
        console.error('babies source failed', s.url, e);
        counters.skipped++;
      }
    }

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
      // CRON は wrangler.toml で設定
      // '0 * * * *'       -> hourly news
      // '15 18 * * *'     -> daily zoos (JST 03:15 相当)
      // '30 18 * * *'     -> daily babies (JST 03:30 相当)
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
  }
};
