// worker/src/sitedate.ts
// B-1(2026-07-29): 日本の自治体・動物園CMSは article:published_time も <time datetime> も
// 出さないことが多く（例: 円山動物園は「更新日：2023年4月29日」というただの本文テキスト）、
// published_at が null のまま resolve に流れて RESOLVE_RECENT_DAYS の足切りを素通りしていた。
// 結果、園公式の「お知らせ一覧」に並ぶ 2020〜2025 年の誕生記事が
// 「いまの赤ちゃん」として一斉に作成された（2026-07-27〜28 に39頭・うち22頭が誤り）。
// → 本文テキストと URL からも記事日付を拾えるようにする。
export function extractSiteDate(html: string, url: string): string | null {
  const clip = html.slice(0, 20000);

  // 1) 本文の日本語日付（更新日／掲載日／公開日の近傍を優先）
  const labeled = clip.match(/(?:更新日|掲載日|公開日|投稿日)[^0-9]{0,8}(\d{4})[年.\/-](\d{1,2})[月.\/-](\d{1,2})/);
  if (labeled) return ymd(labeled[1], labeled[2], labeled[3]);

  // 2) 和暦（令和N年M月D日）→ 西暦
  const wareki = clip.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (wareki) return ymd(String(2018 + Number(wareki[1])), wareki[2], wareki[3]);

  // 3) 素の西暦日付（YYYY年M月D日 / YYYY.M.D / YYYY-MM-DD）
  const plain = clip.match(/(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})/);
  if (plain) return ymd(plain[1], plain[2], plain[3]);

  // 4) URL に埋まった日付（/2026/06/ , /20260714- , /news_t/20260602/ , /r8/=令和8年）
  const u8 = url.match(/(20\d{2})(\d{2})(\d{2})/);
  if (u8) return ymd(u8[1], u8[2], u8[3]);
  const u6 = url.match(/\/(20\d{2})\/(\d{1,2})\//);
  if (u6) return ymd(u6[1], u6[2], '1');
  const ur = url.match(/\/r(\d{1,2})\//);
  if (ur) return ymd(String(2018 + Number(ur[1])), '1', '1');

  return null;
}

export function ymd(y: string, m: string, d: string): string | null {
  const Y = Number(y), M = Number(m), D = Number(d);
  if (!Y || !M || !D || M > 12 || D > 31) return null;
  if (Y < 2000 || Y > new Date().getUTCFullYear() + 1) return null;
  return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}T00:00:00.000Z`;
}

