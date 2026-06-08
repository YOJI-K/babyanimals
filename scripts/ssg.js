#!/usr/bin/env node
/**
 * scripts/ssg.js — どうベビ 静的サイト生成スクリプト
 *
 * 実行: node scripts/ssg.js
 * 出力:
 *   web/babies/{id}/index.html  — 赤ちゃん個別ページ（全件）
 *   web/news/{id}/index.html    — ニュース個別ページ（全件）
 *   web/sitemap.xml             — サイトマップ（全URL）
 *
 * 環境変数（省略時は既存の公開キーを使用）:
 *   SUPABASE_URL       Supabase プロジェクト URL
 *   SUPABASE_ANON_KEY  Supabase anon key
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZOOS, groupByPrefecture, toAffiliateMap } from './zoos-data.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR    = path.resolve(__dirname, '../web');
const SITE_BASE  = 'https://zoobabies.jp';

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://hvhpfrksyytthupboaeo.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY';

// ─── ユーティリティ ─────────────────────────────────────────────────

/** HTML エスケープ */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** YYYY-MM-DD を「YYYY年MM月DD日」に */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
}

/** 年齢（満年齢） */
function calcAgeYears(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  const now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  const diffM = now.getMonth() - b.getMonth();
  if (diffM < 0 || (diffM === 0 && now.getDate() < b.getDate())) y--;
  return y;
}

/** 月齢（総月数） */
function calcAgeMonths(birthday) {
  if (!birthday) return null;
  const b = new Date(birthday);
  const now = new Date();
  let m = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) m--;
  return m;
}

/** 表示用年齢テキスト */
function ageText(birthday) {
  const y = calcAgeYears(birthday);
  if (y === null) return '年齢不明';
  if (y === 0) {
    const m = calcAgeMonths(birthday) ?? 0;
    const rem = m % 12;
    return rem > 0 ? `0歳（${rem}か月）` : '生後1か月未満';
  }
  return `${y}歳`;
}

/** pill の age suffix（CSS クラス用、最大3） */
function ageSuffix(birthday) {
  const y = calcAgeYears(birthday);
  return String(Math.min(y ?? 0, 3));
}

// ─── slug ユーティリティ ────────────────────────────────────────────

function slugify(str) {
  if (!str) return '';
  return str
    .replace(/[（(]/g, '-').replace(/[）)]/g, '')
    .replace(/[　 　・]+/g, '-')
    .replace(/[「」『』【】。、！？〜～／＊]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function makeBabySlug(b, usedSlugs) {
  const base = [slugify(b.name), slugify(b.species), slugify(b.zoo_name)]
    .filter(Boolean).join('-');
  if (!usedSlugs.has(base)) { usedSlugs.add(base); return base; }
  const fallback = `${base}-${b.id.replace(/-/g, '').slice(0, 8)}`;
  usedSlugs.add(fallback);
  return fallback;
}

function buildSlugMap(babies) {
  const usedSlugs = new Set();
  const map = new Map();
  for (const b of babies) {
    if (!b.id) continue;
    map.set(b.id, makeBabySlug(b, usedSlugs));
  }
  return map;
}

// ─── Supabase REST ──────────────────────────────────────────────────

async function sbFetch(urlPath) {
  const res = await fetch(`${SUPABASE_URL}${urlPath}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Accept-Profile': 'public',
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${urlPath} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

// ─── ファイル出力 ───────────────────────────────────────────────────

function writeHtml(filePath, html) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, 'utf-8');
}

// ─── 共通 HTML パーツ ───────────────────────────────────────────────

// GA4 計測ID（CF Pages ビルド環境変数 GA_MEASUREMENT_ID が優先、未設定時はプレースホルダ）
const GA_ID = process.env.GA_MEASUREMENT_ID || 'G-YRQJXRMEN2';

// Google AdSense（CF Pages 環境変数 ADSENSE_CLIENT / ADSENSE_SLOT_BABY で有効化）
// 承認後: Cloudflare Pages のダッシュボードで環境変数を設定し再デプロイ
const ADSENSE_CLIENT    = process.env.ADSENSE_CLIENT    || 'ca-pub-XXXXXXXXXXXXXXXXX';
const ADSENSE_SLOT_BABY = process.env.ADSENSE_SLOT_BABY || 'XXXXXXXXXX';
// プレースホルダーのままなら広告を非表示（XXXXX が含まれる場合は未設定とみなす）
const ADSENSE_ENABLED   = !/X{5}/.test(ADSENSE_CLIENT);

function htmlHead({ title, desc, ogImage, canonical, jsonLd, extraMeta, extraJsonLd, ogType, robots }) {
  const og = ogImage || `${SITE_BASE}/assets/img/og.png`;
  const ogTypeVal = ogType || 'article';
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="${robots || 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'}" />
  <meta name="theme-color" content="#ffd6e3" />
  <meta name="format-detection" content="telephone=no" />
  <meta property="og:type" content="${ogTypeVal}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${esc(og)}" />
  <meta property="og:image:alt" content="${esc(title)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:site_name" content="どうベビ" />
  <meta property="og:locale" content="ja_JP" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${esc(og)}" />
  <meta name="twitter:image:alt" content="${esc(title)}" />
  <meta name="pinterest:description" content="${esc(desc)}" />
  <meta name="pinterest-rich-pin" content="true" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml" />
  ${extraMeta || ''}
  <meta name="google-site-verification" content="yqP_OZz3Qm_iPw3wLSlhofOmYHwrFf3CyU7psadeE-U" />
  <meta name="google-adsense-account" content="ca-pub-7279120932069417">
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="/assets/css/style.css" />
  <!-- Google tag (gtag.js) — GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>
  ${ADSENSE_ENABLED ? `<!-- Google AdSense -->
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>` : '<!-- Google AdSense: 環境変数 ADSENSE_CLIENT を設定すると有効化されます -->'}
  <script type="application/ld+json">${jsonLd}</script>
  ${extraJsonLd || ''}
</head>`;
}

function siteHeader() {
  return `<header class="site-header site-header--candy">
  <div class="site-header__left">
    <a class="brand" href="/" aria-label="ホームへ">
      <svg class="brand__icon" aria-hidden="true" focusable="false">
        <use href="/assets/icons/icons.svg#icon-logo"></use>
      </svg>
      <span class="brand__title">どうベビ</span>
    </a>
  </div>
</header>`;
}

function siteNav(activeHref) {
  const tabs = [
    { href: '/',          icon: 'icon-home',      label: 'ホーム'       },
    { href: '/news/',     icon: 'icon-newspaper', label: 'ニュース'     },
    { href: '/babies/',   icon: 'icon-paw',       label: '赤ちゃん'     },
    { href: '/zoos/',     icon: 'icon-landmark',  label: '動物園'       },
    { href: '/calendar/', icon: 'icon-calendar',  label: 'カレンダー'   },
  ];
  const links = tabs.map(t => {
    const active = t.href === activeHref ? ' is-active" aria-current="page' : '';
    return `  <a class="tabbar__link${active}" href="${t.href}" title="${t.label}">
    <svg class="tab-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#${t.icon}"></use></svg>
    <span class="tabbar__text">${t.label}</span>
  </a>`;
  }).join('\n');
  return `<nav class="tabbar tabbar--stack" aria-label="メイン">\n${links}\n</nav>`;
}

function siteFooter() {
  return `<footer class="site-footer" aria-label="フッター">
  <small>© どうベビ（動物園ベビー情報）　<a href="/specials/" style="color:inherit;opacity:0.7;font-size:0.9em;">特集</a>　<a href="/about/" style="color:inherit;opacity:0.7;font-size:0.9em;">運営者情報</a>　<a href="/sitemap/" style="color:inherit;opacity:0.7;font-size:0.9em;">サイトマップ</a>　<a href="/privacy/" style="color:inherit;opacity:0.7;font-size:0.9em;">プライバシーポリシー</a>　<a href="/contact/" style="color:inherit;opacity:0.7;font-size:0.9em;">お問い合わせ</a></small>
</footer>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
        data-cf-beacon='{"token":"5b85d28b47c74f79b6ad1c1f19c0a758"}'></script>
<script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js" crossorigin="anonymous"></script>
<script>document.addEventListener('DOMContentLoaded',function(){if(window.twemoji)twemoji.parse(document.body,{folder:'svg',ext:'.svg',base:'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/'});});</script>`;
}

// ─── 動物園アフィリエイトデータ ──────────────────────────────────────
// zoos-data.js から生成（マスターデータの一元管理）
// 掲載内容の追加/修正は scripts/zoos-data.js を編集してください
const ZOO_AFFILIATE_MAP = toAffiliateMap();

// ─── 種別解説マスター ────────────────────────────────────────────────
// 各種の説明文・IUCN保全状況。babyHtml() で species キーで参照する。
const SPECIES_INFO = {
  'ホッキョクグマ': {
    iucn: 'VU（危急種）',
    desc: 'ホッキョクグマは北極圏の氷上に生息する世界最大の陸上肉食動物で、体長は最大3メートルにもなります。赤ちゃんは約500gという小さな体で生まれ、母親の温かい巣穴で約3ヶ月間育てられてから外の世界に出てきます。IUCNレッドリストでは「危急種（VU）」に指定されており、気候変動による海氷の減少が最大の脅威となっています。動物園での繁殖は種の保全に重要な役割を果たしています。',
  },
  'コビトカバ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'コビトカバは西アフリカの熱帯雨林に生息する小型のカバで、体重は180〜275kgと普通のカバの約10分の1ほど。森の中で単独生活をする神秘的な動物です。赤ちゃんは生後数時間で立ち上がり、母親と森の中を行動します。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、野生での生息数は2,500頭以下とされる希少種。動物園での繁殖例は世界的にも非常に貴重です。',
  },
  'ニシゴリラ': {
    iucn: 'CR（野生絶滅危惧種）',
    desc: 'ニシゴリラは中央アフリカの熱帯雨林に生息する類人猿で、ヒトとのDNA共通率は約98.7%。社会性が高く、シルバーバックと呼ばれるオスをリーダーとした家族群で生活します。赤ちゃんは生後約4〜5年間母親の背中やお腹にしがみついて移動します。IUCNレッドリストでは「野生絶滅危惧種（CR）」に指定されており、野生個体数の減少が深刻。動物園での誕生は種の保全に大きく貢献します。',
  },
  'スマトラトラ': {
    iucn: 'CR（野生絶滅危惧種）',
    desc: 'スマトラトラはインドネシア・スマトラ島のみに生息するトラの亜種で、現存するトラの中で最も小型。体長150〜180cm、縞模様が他の亜種に比べて細かいのが特徴です。赤ちゃんは生後2週間は目が開かず、母親に完全に依存して育ちます。IUCNレッドリストでは「野生絶滅危惧種（CR）」に指定されており、野生での生息数は400頭未満。動物園での繁殖は種の存続に欠かせない取り組みです。',
  },
  'アムールトラ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'アムールトラ（シベリアトラ）はロシア極東・中国北部に生息する世界最大のネコ科動物で、体長は最大3.7メートルに達します。寒冷地に適応した厚い体毛と豊富な皮下脂肪が特徴。赤ちゃんは約100日の妊娠期間を経て2〜4頭生まれ、約6ヶ月間母乳で育てられます。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、野生個体数は約500〜600頭と推定されています。',
  },
  'テングザル': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'テングザルはボルネオ島固有のサルで、オスの大きな鼻が特徴的。鼻は興奮すると赤くなり、メスへのアピールに使われます。群れで生活し、水辺を好む珍しいサルで、泳ぎが得意です。赤ちゃんは生後数週間は顔が青みがかった独特の色をしており、成長とともに変化します。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、生息地の森林破壊により個体数が急減しています。',
  },
  'ミナミコアリクイ': {
    iucn: 'NT（準絶滅危惧）',
    desc: 'ミナミコアリクイは南米に生息するコアリクイの仲間で、体長50〜90cmほどの中型種。長い舌でアリやシロアリを舐め取って食べ、歯は持っていません。赤ちゃんは生まれると母親の背中に乗り、体の模様が親の模様と合わさって外敵に見つかりにくくなる巧みなカモフラージュをします。IUCNレッドリストでは「準絶滅危惧（NT）」に指定されており、生息地の保全活動に動物園も貢献しています。',
  },
  'マサイキリン': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'マサイキリンはアフリカのサバンナに生息するキリンの亜種で、不規則なギザギザ模様が特徴。体高は最大5.5メートルと陸上動物最大の身長を誇ります。赤ちゃんは生まれた直後から立ち上がり、生後数時間で走れるようになる早熟な動物。誕生時の身長はすでに約1.8メートルあります。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、動物園での繁殖が保全に貢献しています。',
  },
  'エランド': {
    iucn: 'LC（軽度懸念）',
    desc: 'エランドはアフリカのサバンナに生息する世界最大のレイヨウ（アンテロープ）で、体重は最大1トンにもなります。雄雌ともに角を持ちます。群れで生活し、草や葉を食べます。赤ちゃんは生後すぐに立ち上がれる早熟な動物で、母親の保護のもとすぐに群れに合流します。IUCNレッドリストでは「軽度懸念（LC）」に指定されており、比較的安定した個体数を維持しています。',
  },
  'ミーアキャット': {
    iucn: 'LC（軽度懸念）',
    desc: 'ミーアキャットは南アフリカのカラハリ砂漠に生息するマングースの仲間で、後ろ足で直立して周囲を見渡す姿が特徴的。群れで協力して子育てや見張りをする高い社会性を持ちます。赤ちゃんは目が開かない状態で生まれ、巣穴の中で数週間育てられます。群れの仲間が交代で世話をする「ヘルパー」の行動は動物行動学でも注目されており、動物園でも仲むつまじい家族の様子が観察できます。IUCNレッドリストでは「軽度懸念（LC）」に指定されています。',
  },
  'ホワイトタイガー': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'ホワイトタイガーはベンガルトラの白色変異個体で、白い体毛と青い瞳が美しい希少な存在です。白色の毛色は劣性遺伝子によるもので、野生ではほとんど見られません。トラ全体としてIUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、野生個体数は世界全体で4,000頭以下とされています。赤ちゃんは生後2週間ほどで目が開き、生後6ヶ月ごろから母親と学びながら成長します。動物園での繁殖が種の保全に貢献しています。',
  },
  'レッサーパンダ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'レッサーパンダはヒマラヤ山脈東部から中国南西部にかけての高地に生息し、赤茶色の毛並みとふさふさした縞尾が特徴。竹の葉を主食とし、樹上生活が得意です。赤ちゃんは巣箱の中で生まれ、最初は目も耳も閉じた状態で、約3ヶ月で巣立ちを迎えます。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、生息地の森林減少が脅威。動物園での繁殖が保全に重要な役割を果たしています。',
  },
  'コアラ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'コアラはオーストラリア東部の森林に生息する有袋類で、ユーカリの葉だけを食べる特殊な動物。赤ちゃんは約35日の妊娠期間で生まれ、米粒ほどの大きさで母親のお腹の袋に入り約6ヶ月育てられます。その後も約1年間母親の背中にしがみついて過ごします。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、森林火災や生息地の減少が深刻な脅威。動物園での繁殖が種の保全に貢献しています。',
  },
  'アジアゾウ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'アジアゾウは南・東南アジアの森林に生息するゾウで、小さめの耳と丸みのある背中が特徴。高い知性と記憶力を持ち、複雑な社会を形成します。赤ちゃんは約22ヶ月という陸上動物最長クラスの妊娠期間を経て生まれ、群れ全体で育てられます。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、生息地の消失と人間との軋轢が深刻な問題。動物園での繁殖と保全活動が世界規模で進められています。',
  },
  'アミメキリン': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'アミメキリンはアフリカ東部のサバンナに生息するキリンの亜種で、大きな多角形の模様が網目のように見えることが名前の由来。体高は最大5.8メートルに達し、世界最大の陸上動物として知られます。赤ちゃんは立った姿勢で生まれ、誕生時の体高は約1.8〜2メートル。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、動物園での繁殖が保全に貢献しています。',
  },
  'キリン': {
    iucn: 'VU（危急種）',
    desc: 'キリンはアフリカのサバンナに生息する世界で最も背の高い陸上動物で、体高は4〜6メートルにもなります。長い首は高い木の葉を食べるのに適しており、70cmもの舌で葉をつかみます。赤ちゃんは生まれてすぐに約1.8メートルの身長があり、数時間以内に自力で立ち上がります。IUCNレッドリストでは「危急種（VU）」に指定されており、密猟や生息地の破壊が個体数減少の原因。動物園での繁殖が保全に貢献しています。',
  },
  'コツメカワウソ': {
    iucn: 'VU（危急種）',
    desc: 'コツメカワウソは東南アジアから南アジアの河川・湿地に生息する世界最小のカワウソ。前足の爪が短く、器用な手先で貝や小魚をつかんで食べます。群れで生活し、仲間とのコミュニケーションが豊かで、親から子へ生きるすべを丁寧に教えます。赤ちゃんは目が閉じた状態で生まれ、両親を含む家族全員で協力して育てます。IUCNレッドリストでは「危急種（VU）」に指定されており、湿地の破壊やペット需要が脅威となっています。',
  },
  'ライオン': {
    iucn: 'VU（危急種）',
    desc: 'ライオンはサハラ以南のアフリカのサバンナに生息する大型ネコ科動物で、「百獣の王」として親しまれます。群れ（プライド）で生活する唯一のネコ科動物で、オスは特徴的なたてがみを持ちます。赤ちゃんは2〜4頭で生まれ、群れの母親たちが協力して育てる社会的な子育てが見られます。IUCNレッドリストでは「危急種（VU）」に指定されており、過去20年で野生個体数が大幅に減少。動物園での繁殖が保全に貢献しています。',
  },
  'ニホンザル': {
    iucn: 'LC（軽度懸念）',
    desc: 'ニホンザルは日本固有のサルで、世界で最も北に生息する霊長類（ヒトを除く）として知られます。北は青森から南は屋久島まで広く分布し、温泉に入ることで有名な地獄谷野猿公苑の個体群が世界的に知られています。赤ちゃんは母親の胸にしがみついて移動し、群れ全体で子育てを行います。IUCNレッドリストでは「軽度懸念（LC）」に指定されており、日本の自然を代表する動物として動物園でも身近に観察できます。',
  },
  'オカピ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'オカピはコンゴ民主共和国の熱帯雨林に生息するキリン科の動物で、縞模様の脚と長い舌が特徴。キリンに最も近い仲間ですが、見た目はシマウマとウマを合わせたような独特の姿をしています。森の中で単独生活をする神秘的な動物で、西洋に存在が知られたのは20世紀初頭のこと。赤ちゃんは生まれてすぐに立ち上がれます。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、動物園での繁殖が保全に重要な意義を持ちます。',
  },
  'マルミミゾウ': {
    iucn: 'CR（野生絶滅危惧種）',
    desc: 'マルミミゾウは中央アフリカの熱帯雨林に生息するゾウで、丸い耳と小柄な体型が特徴。長らくアフリカゾウの亜種とされていましたが、遺伝子研究により独立した種と確認されました。森の中を単独または小さな群れで生活します。IUCNレッドリストでは「野生絶滅危惧種（CR）」に指定されており、ゾウの中で最も絶滅リスクが高い種のひとつ。動物園での繁殖が種の将来にとって非常に重要な意味を持ちます。',
  },
  'ケープハイラックス': {
    iucn: 'LC（軽度懸念）',
    desc: 'ケープハイラックスはアフリカと中東に広く生息する小型哺乳類で、見た目はモルモットのようですが、実はゾウやジュゴンに最も近い仲間という意外な動物。岩場に群れで生活し、日光浴を好みます。赤ちゃんは生まれた時からすでに毛が生え、目も開いた状態で産まれる早成型。IUCNレッドリストでは「軽度懸念（LC）」に指定されており、動物園でものんびりした姿が人気です。',
  },
  'フンボルトペンギン': {
    iucn: 'VU（危急種）',
    desc: 'フンボルトペンギンは南アメリカのチリ・ペルー海岸に生息するペンギンで、フンボルト海流の冷たい海に適応しています。胸の黒い帯模様が特徴で、巣穴を掘って繁殖します。赤ちゃんは灰色の羽毛をまとって生まれ、親からの給餌を受けながら約3ヶ月で独立します。IUCNレッドリストでは「危急種（VU）」に指定されており、エルニーニョ現象による餌不足や沿岸開発が脅威。動物園での繁殖が保全に貢献しています。',
  },
  'インドサイ': {
    iucn: 'VU（危急種）',
    desc: 'インドサイ（イッカクサイ）は南アジアのインド・ネパールのみに生息する1本角のサイ。体重は最大2.7トンにもなる巨大な動物で、厚い皮膚がよろいのような見た目をしています。赤ちゃんは約16ヶ月の妊娠期間を経て1頭生まれ、2〜3年間母親と過ごします。IUCNレッドリストでは「危急種（VU）」に指定されており、保全活動の成果により20世紀初頭から個体数が大幅に回復。動物園での繁殖も保全に貢献しています。',
  },
  'カリフォルニアアシカ': {
    iucn: 'LC（軽度懸念）',
    desc: 'カリフォルニアアシカは北アメリカ太平洋岸に生息するアシカで、高い知能と愛嬌のある顔が特徴。泳ぎが得意で時速40kmにも達します。赤ちゃんは生後すぐに母親の鳴き声を覚え、群れの中で迷子にならないよう学びます。活発でコミュニケーション豊かな性質のため、動物園でも特に人気の動物。IUCNレッドリストでは「軽度懸念（LC）」に指定されており、比較的安定した個体数を維持しています。',
  },
    'ゾウ': {
    iucn: 'EN/CR（絶滅危惧種〜野生絶滅危惧種、種により異なる）',
    desc: 'ゾウは現生最大の陸上動物で、アジアゾウ・アフリカゾウ・マルミミゾウの3種に分類されます。寿命は約60〜70年、社会性が高く、メスを中心とした母系家族群で生活します。赤ちゃんは妊娠22ヶ月という哺乳類最長クラスの妊娠期間を経て、体重100kg前後で生まれます。野生個体数の減少から各種ともIUCNレッドリストで絶滅危惧クラスに指定されており、動物園での繁殖は種の保全に重要です。',
  },
  'アメリカビーバー': {
    iucn: 'LC（軽度懸念）',
    desc: 'アメリカビーバーは北アメリカの河川・湖に生息する「自然のエンジニア」で、木を噛み倒してダムを作ることで有名。体長は約1メートル、扁平な尾が特徴的です。ダムにより周囲の環境を大きく変え、多くの生き物の生息地を作ります。赤ちゃんは毛皮に覆われた状態で生まれ、親のダムの中で育てられます。IUCNレッドリストでは「軽度懸念（LC）」に指定されており、個体数は安定しています。',
  },
  'トラ': {
    iucn: 'EN（絶滅危惧種）',
    desc: 'トラはアジアに生息する世界最大のネコ科動物で、オレンジ色の体に黒い縞模様が一頭ごとに異なる「指紋」のように違うのが特徴。アムールトラ・ベンガルトラ・スマトラトラなど複数の亜種に分かれます。単独で広い縄張りを持って生活し、泳ぎも得意です。赤ちゃんは2〜4頭で生まれ、生後約2週間で目が開き、母親から狩りを学びながら2年ほどで独立します。IUCNレッドリストでは「絶滅危惧種（EN）」に指定されており、野生では4,000頭ほどしか残っていません。動物園での繁殖が種の保全に重要な役割を果たしています。',
  },
  'マンドリル': {
    iucn: 'VU（危急種）',
    desc: 'マンドリルは中央アフリカの熱帯雨林に生息する世界最大のサルで、オスの顔の赤と青の鮮やかな色彩が最大の特徴。この色は興奮すると一段と濃くなり、群れの中の順位を示すサインにもなります。数百頭にもなる大きな群れで生活する社会性の高い動物です。赤ちゃんは母親にしっかりとしがみついて育ち、群れの仲間に見守られながら成長します。IUCNレッドリストでは「危急種（VU）」に指定されており、森林伐採や狩猟により生息数が減少。動物園での繁殖が保全に貢献しています。',
  },
  'カバ': {
    iucn: 'VU（危急種）',
    desc: 'カバはアフリカの川や湖に生息する大型の草食動物で、体重は最大3トンを超えます。一日の大半を水中で過ごし、皮膚を守るために「血の汗」と呼ばれる赤い分泌液を出すことで知られます。見た目はおっとりしていますが、実はアフリカで最も危険な動物のひとつとされる力強さを持ちます。赤ちゃんは水中で生まれることもあり、生後すぐに泳いで母親のもとへ向かいます。IUCNレッドリストでは「危急種（VU）」に指定されており、密猟や生息地の減少が脅威となっています。',
  },
  'ペンギン': {
    iucn: '種により異なる（LC〜EN）',
    desc: 'ペンギンは主に南半球に生息する飛べない海鳥で、翼をひれ（フリッパー）のように使って水中を自在に泳ぎます。世界には約18種が知られ、フンボルトペンギンやケープペンギンなど動物園で人気の種も多くいます。陸上ではよちよち歩く愛らしい姿が魅力。赤ちゃんはふわふわの綿羽（めんう）に包まれて生まれ、親が交代で温め餌を与えて育てます。種によって保全状況は「軽度懸念（LC）」から「絶滅危惧種（EN）」までさまざまで、海洋環境の保全が重要な課題です。',
  },
  'マヌルネコ': {
    iucn: 'LC（低危険種）',
    desc: 'マヌルネコは中央アジアの寒冷な草原や岩場に暮らす小型の野生ネコで、ずんぐりした体と密生した長い毛が特徴です。赤ちゃんは春に2〜6頭生まれ、生後2か月ほどで巣穴から出て活動を始めます。標高の高い厳しい環境に適応していますが、生息地の分断や乱獲などの影響を受けています。IUCNレッドリストでは2020年の再評価で低危険種（LC）に分類されています。',
  },
  'ジャガー': {
    iucn: 'NT（準絶滅危惧）',
    desc: 'ジャガーは南北アメリカ大陸に生息するネコ科で、アメリカ大陸最大、世界でも3番目に大きいネコです。がっしりした体と強い咬む力を持ち、泳ぎも得意です。赤ちゃんは1〜4頭生まれ、生後およそ半年は母親と過ごして狩りを学びます。1880年代以降に生息地の半分以上を失い、IUCNレッドリストでは準絶滅危惧（NT）に指定されています。',
  },
};

/** 動物園リンクボタン HTML を生成（ssg.js 用） */
function zooLinksHtml(zooName, animalName) {
  const data = ZOO_AFFILIATE_MAP[zooName];
  if (!data) return '';

  const safeZoo    = esc(zooName);
  const safeAnimal = esc(animalName);
  const buttons = [];

  const svgTicket = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-ticket"></use></svg>`;
  const svgMapPin = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-map-pin"></use></svg>`;

  if (data.asoview_url) {
    buttons.push(`<a class="zoo-link zoo-link--ticket"
         href="${esc(data.asoview_url)}"
         target="_blank" rel="noopener sponsored"
         data-link-type="ticket"
         data-zoo-name="${safeZoo}"
         data-animal-name="${safeAnimal}">
      ${svgTicket} チケットを事前予約 <small class="zoo-link__pr">広告</small>
    </a>`);
  } else {
    buttons.push(`<a class="zoo-link zoo-link--ticket"
         href="${asoviewAffiliate()}"
         target="_blank" rel="noopener sponsored"
         data-link-type="ticket-generic"
         data-zoo-name="${safeZoo}"
         data-animal-name="${safeAnimal}">
      ${svgTicket} チケットを事前予約 <small class="zoo-link__pr">広告</small>
    </a>`);
  }
  if (data.official_url) {
    buttons.push(`<a class="zoo-link zoo-link--official"
         href="${esc(data.official_url)}"
         target="_blank" rel="noopener noreferrer"
         data-link-type="official"
         data-zoo-name="${safeZoo}"
         data-animal-name="${safeAnimal}">
      ${svgMapPin} 公式サイト（アクセス・料金）
    </a>`);
  }
  if (!buttons.length) return '';

  return `<section class="visit-cta">
    <h2 class="visit-cta__title">🎟️ この子に会いに行こう</h2>
    <p class="visit-cta__lead">${safeZoo}で待っています。当日窓口と同じ料金で、並ばず入園できます。</p>
    <div class="zoo-links" aria-label="${safeZoo}へのリンク">
      ${buttons.join('\n      ')}
    </div>
    <p class="zoo-link__note">アソビュー（正規取扱）｜お支払額は当日窓口と変わりません</p>
  </section>`;
}

// ─── 汎用アフィリエイト（asoview）リンク ─────────────────────────────
// PROP-20260603-01: 個別の動物園 asoview が無いページにも収益導線を常設する。
const A8_ASOVIEW_MAT = '4B1KXR+740FOA+455G+BW0YB';
const ASOVIEW_GENERIC_URL = 'https://www.asoview.com/';

/** asoview の任意 URL を A8 計測リンクでラップ */
function asoviewAffiliate(targetUrl = ASOVIEW_GENERIC_URL) {
  return `https://px.a8.net/svt/ejp?a8mat=${A8_ASOVIEW_MAT}&a8ejpredirect=${encodeURIComponent(targetUrl)}`;
}

/** 汎用 asoview CTA セクション（特定動物園 asoview が無いページ用フォールバック） */
function genericAsoviewCta(lead = '公式提携の電子チケット。当日窓口と同じ料金で、列に並ばず入園できます。') {
  const svgTicket = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-ticket"></use></svg>`;
  return `<section class="visit-cta">
    <h2 class="visit-cta__title">🎟️ 動物園・水族館に行こう</h2>
    <p class="visit-cta__lead">${lead}</p>
    <div class="zoo-links" aria-label="チケット予約リンク">
      <a class="zoo-link zoo-link--ticket"
         href="${asoviewAffiliate()}"
         target="_blank" rel="noopener sponsored"
         data-link-type="ticket-generic">
        ${svgTicket} チケットを事前予約 <small class="zoo-link__pr">広告</small>
      </a>
    </div>
    <p class="zoo-link__note">アソビュー（正規取扱）｜お支払額は当日窓口と変わりません</p>
  </section>`;
}

// ─── 赤ちゃん個別ページ ─────────────────────────────────────────────

function babyHtml(b, slug, allBabies, slugMap, babyNews) {
  const name     = b.name    || '赤ちゃん';
  const species  = b.species || '動物';
  const zoo      = b.zoo_name || '（動物園不明）';
  const bdayFmt  = fmtDate(b.birthday);
  const age      = ageText(b.birthday);
  const birthdayYear = b.birthday ? new Date(b.birthday).getFullYear() : null;
  const canonical = `${SITE_BASE}/babies/${slug}/`;

  const title = `${name}（${species}）の赤ちゃん｜${zoo}`;
  const desc  = `${zoo}で${birthdayYear ? `${birthdayYear}年に` : ''}生まれた${species}の赤ちゃん「${name}」。誕生日は${bdayFmt || '不明'}、現在${age}。どうベビで動物園の赤ちゃん情報をチェック。`;

  // 種別解説マスターからデータ取得（articleLd で参照するため早期に宣言）
  const speciesData = SPECIES_INFO[species] || null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const articleLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: `${name}（${species}）の赤ちゃん｜${zoo}`,
    description: desc,
    image: [b.thumbnail_url || `${SITE_BASE}/assets/img/og.png`],
    url: canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    datePublished: b.birthday || todayIso,
    dateModified: todayIso,
    inLanguage: 'ja',
    isAccessibleForFree: true,
    author: { '@type': 'Organization', name: 'どうベビ編集部', url: SITE_BASE },
    publisher: {
      '@type': 'Organization',
      name: 'どうベビ',
      url: SITE_BASE,
      logo: { '@type': 'ImageObject', url: `${SITE_BASE}/assets/img/og.png`, width: 1200, height: 630 }
    },
    about: {
      '@type': 'Animal',
      name: name,
      description: speciesData ? speciesData.desc.slice(0, 160) : `${species}の赤ちゃん`,
    },
    keywords: [name, species, '赤ちゃん', zoo, '動物園', birthdayYear ? String(birthdayYear) + '年生まれ' : ''].filter(Boolean).join(','),
  });

  // Pinterest / 詳細OGPメタ
  const extraMetaTags = `
  <meta property="article:published_time" content="${esc(b.birthday || todayIso)}" />
  <meta property="article:modified_time" content="${esc(todayIso)}" />
  <meta property="article:section" content="動物の赤ちゃん" />
  <meta property="article:tag" content="${esc(species)}" />
  <meta property="article:tag" content="${esc(zoo)}" />
  <meta property="article:tag" content="赤ちゃん" />
  <meta name="keywords" content="${esc(name)},${esc(species)},赤ちゃん,${esc(zoo)},動物園,${birthdayYear || ''}" />`;

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: '赤ちゃん一覧', item: `${SITE_BASE}/babies/` },
      { '@type': 'ListItem', position: 3, name: `${name}（${species}）の赤ちゃん`, item: canonical },
    ],
  });

  const thumbHtml = b.thumbnail_url
    ? `<img class="ssg-detail__img" src="${esc(b.thumbnail_url)}" alt="${esc(name)}（${esc(species)}）" loading="eager" decoding="async" data-allow-big>`
    : `<div class="ssg-detail__img ssg-detail__img--placeholder" role="img" aria-label="写真なし">🐾</div>`;

  // 同じ動物園の赤ちゃん（最大6件）
  const sameZoo = (allBabies || [])
    .filter(x => x.zoo_name === b.zoo_name && x.id !== b.id)
    .slice(0, 6);

  // 同じ種別の赤ちゃん（同動物園は除外、最大6件）
  const sameSpecies = (allBabies || [])
    .filter(x => x.species === b.species && x.id !== b.id && x.zoo_name !== b.zoo_name)
    .slice(0, 6);

  // 種の紹介文セクション
  const speciesInfoHtml = speciesData ? `
    <section class="species-info">
      <h2 class="species-info__title">🌿 ${esc(species)}について</h2>
      <p class="species-info__desc">${speciesData.desc}</p>
    </section>` : '';

  // === 「この子・この園の最新ニュース」（zoo_id経由の紐付け） ===
  const newsList = Array.isArray(babyNews) ? babyNews : [];
  const nameMatchNews = newsList.filter(n => isNameStrongMatch(n.title, b));
  const ownStoryCount = nameMatchNews.length;

  const babyNewsHtml = newsList.length ? `
    <section class="baby-news" aria-labelledby="baby-news-title">
      <h2 class="baby-news__title" id="baby-news-title">🗞️ ${esc(name)}と${esc(zoo)}の最新ニュース</h2>
      <ul class="baby-news__list">
        ${newsList.map(n => {
          const date = fmtDate(n.published_at) || '';
          const src  = n.source_name || '';
          const featured = isNameStrongMatch(n.title, b);
          return `<li class="baby-news__item${featured ? ' is-featured' : ''}">
            <a class="baby-news__link" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
              <span class="baby-news__headline">${esc(n.title)}</span>
              <span class="baby-news__meta">${esc(date)}${src ? ' / ' + esc(src) : ''}${featured ? ' <span class="baby-news__badge">この子の話題</span>' : ''}</span>
            </a>
          </li>`;
        }).join('\n        ')}
      </ul>
      <p class="baby-news__note">※ ニュース見出しは外部メディアの公開情報を引用しています。リンク先で本文をご確認ください。</p>
    </section>` : '';

  // === 「この子のストーリー」自動生成エピソードテキスト（Step2） ===
  // 個別性を出すため、ベース統計とニュース活用度からダイナミックに文章を組み立てる
  const ageMonthsTotal = b.birthday ? Math.max(0, Math.floor((new Date() - new Date(b.birthday)) / (30.44 * 86400000))) : null;
  const ageYears  = ageMonthsTotal !== null ? Math.floor(ageMonthsTotal / 12) : null;
  const ageMonths = ageMonthsTotal !== null ? ageMonthsTotal % 12 : null;
  const seasonOf = (iso) => {
    if (!iso) return '';
    const m = new Date(iso).getMonth() + 1;
    if (m >= 3 && m <= 5)   return '春';
    if (m >= 6 && m <= 8)   return '夏';
    if (m >= 9 && m <= 11)  return '秋';
    return '冬';
  };
  const season = seasonOf(b.birthday);
  const isInfant = ageMonthsTotal !== null && ageMonthsTotal < 12;
  const isToddler = ageMonthsTotal !== null && ageMonthsTotal >= 12 && ageMonthsTotal < 36;

  const introLines = [];
  if (birthdayYear && season) {
    introLines.push(`${esc(name)}は${birthdayYear}年${season}に${esc(zoo)}で生まれた${esc(species)}の赤ちゃんです。`);
  } else {
    introLines.push(`${esc(name)}は${esc(zoo)}で暮らす${esc(species)}の赤ちゃんです。`);
  }
  if (ageYears !== null) {
    if (isInfant) {
      introLines.push(`誕生から${esc(age)}が経ち、初めての世界を毎日見つけている時期です。`);
    } else if (isToddler) {
      introLines.push(`現在${esc(age)}になり、好奇心いっぱいで動き回る姿が見られます。`);
    } else {
      introLines.push(`現在${esc(age)}に成長し、たくましい姿を見せてくれています。`);
    }
  }
  if (speciesData) {
    if (speciesData.iucn && speciesData.iucn.includes('絶滅') || (speciesData.iucn || '').match(/CR|EN/)) {
      introLines.push(`${esc(species)}は絶滅が心配される希少種で、${esc(name)}の誕生は種の保全にとって大きな意味を持ちます。`);
    } else if ((speciesData.iucn || '').includes('VU') || (speciesData.iucn || '').includes('NT')) {
      introLines.push(`${esc(species)}は野生での生息数が減少傾向にあり、動物園での飼育・繁殖が重要な役割を果たしています。`);
    }
  }
  if (ownStoryCount > 0) {
    introLines.push(`これまでにメディアでも${ownStoryCount}件取り上げられており、${esc(zoo)}の人気者として注目を集めています。`);
  } else if (newsList.length > 0) {
    introLines.push(`${esc(zoo)}では他にもさまざまな動物の話題が日々更新されています。最新の情報はこのページの下部もご覧ください。`);
  }

  // 結び（来園誘導・内部回遊）
  introLines.push(`${esc(zoo)}では${esc(name)}の公開状況が変わることがあります。おでかけ前に最新情報を確認し、${esc(species)}の赤ちゃんの成長をやさしく見守ってください。`);

  const babyEpisodeHtml = `
    <section class="baby-episode" aria-labelledby="baby-episode-title">
      <h2 class="baby-episode__title" id="baby-episode-title">📖 ${esc(name)}のストーリー</h2>
      <div class="baby-episode__body">
        ${introLines.map(l => `<p>${l}</p>`).join('\n        ')}
      </div>
    </section>`;

  // スペック表（種類・動物園は内部ページへリンク＝相互リンク強化）
  const _zooSlug = (ZOOS.find(z => z.db_name === b.zoo_name) || {}).slug || null;
  const speciesCell = b.species ? `<a href="/species/${esc(b.species)}/">${esc(species)}</a>` : esc(species);
  const zooCell = _zooSlug ? `<a href="/zoos/${esc(_zooSlug)}/">${esc(zoo)}</a>` : esc(zoo);
  const specsHtml = `
    <table class="baby-specs">
      <tr><th>なまえ</th><td>${esc(name)}</td></tr>
      <tr><th>種類</th><td>${speciesCell}</td></tr>
      <tr><th>動物園</th><td>${zooCell}</td></tr>
      <tr><th>誕生日</th><td>${esc(bdayFmt) || '不明'}（${esc(age)}）</td></tr>
      ${speciesData ? `<tr><th>保全状況</th><td class="baby-specs__iucn">${speciesData.iucn}</td></tr>` : ''}
    </table>`;

  const sameZooHtml = sameZoo.length ? `
  <section class="ssg-related">
    <h2 class="ssg-related__title">🏛️ ${esc(zoo)}の赤ちゃん</h2>
    <div class="baby-grid">
      ${sameZoo.map(x => zooBabyCardHtml(x, slugMap)).join('\n      ')}
    </div>
  </section>` : '';

  const sameSpeciesHtml = sameSpecies.length ? `
  <section class="ssg-related">
    <h2 class="ssg-related__title">🐾 ほかの${esc(species)}の赤ちゃん</h2>
    <div class="baby-grid">
      ${sameSpecies.map(x => zooBabyCardHtml(x, slugMap)).join('\n      ')}
    </div>
  </section>` : '';

  // === よくある質問（FAQ）— ページ内の他要素と重複しない固有情報で構成（案A） ===
  const faqHref = (x) => `/babies/${(slugMap && slugMap.get(x.id)) || x.id}/`;
  const faqItems = [];
  // ① 会いに行くときの実用情報
  faqItems.push({
    q: `${name}に会いに行くときに気をつけることは？`,
    a: `${name}の公開時間や展示場所は、季節や${species}の体調によって変わることがあります。おでかけ前に${zoo}の公式サイトやSNSで当日の展示状況を確認すると安心です。前売り券を用意しておくと当日スムーズに入園できます。`,
  });
  // ② 同じ動物園のほかの赤ちゃん（内部リンクで回遊強化）
  if (sameZoo.length) {
    const items = sameZoo.slice(0, 4);
    const plain  = items.map(x => `${x.species || '赤ちゃん'}「${x.name}」`).join('、');
    const linked = items.map(x => `<a href="${faqHref(x)}">${esc(x.species || '赤ちゃん')}「${esc(x.name)}」</a>`).join('、');
    faqItems.push({
      q: `${zoo}にはほかにどんな赤ちゃんがいますか？`,
      a: `${zoo}では${name}のほかに、${plain}などの赤ちゃんも暮らしています。`,
      aHtml: `${esc(zoo)}では${esc(name)}のほかに、${linked}などの赤ちゃんも暮らしています。`,
    });
  }
  // ③ 同じ種のほかの赤ちゃん（内部リンクで回遊強化）
  if (sameSpecies.length) {
    const items = sameSpecies.slice(0, 4);
    const plain  = items.map(x => `${x.zoo_name}「${x.name}」`).join('、');
    const linked = items.map(x => `<a href="${faqHref(x)}">${esc(x.zoo_name)}「${esc(x.name)}」</a>`).join('、');
    faqItems.push({
      q: `${name}と同じ${species}の赤ちゃんはほかにもいますか？`,
      a: `はい。${plain}など、ほかの動物園でも${species}の赤ちゃんに会えます。`,
      aHtml: `はい。${linked}など、ほかの動物園でも${esc(species)}の赤ちゃんに会えます。`,
    });
  }
  // ④ やさしい観察（ブランド軸・常時表示）
  faqItems.push({
    q: `赤ちゃんを見るときに大切にしたいことは？`,
    a: `赤ちゃんは体調や気分で展示をお休みすることもあります。「見られたらラッキー」という気持ちで、大きな声や急な動きは控え、そっと見守ってあげましょう。やさしい観察が、すこやかな成長を支えます。`,
  });
  const babyFaqLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  });
  const babyFaqHtml = faqItems.length ? `
    <section class="baby-faq" aria-labelledby="baby-faq-title">
      <h2 class="baby-faq__title" id="baby-faq-title">❓ ${esc(name)}についてよくある質問</h2>
      <div class="baby-faq__list">
        ${faqItems.map((f, i) => `<details class="baby-faq__item"${i === 0 ? ' open' : ''}><summary class="baby-faq__q">${esc(f.q)}</summary><div class="baby-faq__a">${f.aHtml || esc(f.a)}</div></details>`).join('\n        ')}
      </div>
    </section>` : '';
  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, ogImage: b.thumbnail_url, canonical, jsonLd: articleLd, extraMeta: extraMetaTags })}
<script type="application/ld+json">${breadcrumbLd}</script>
<script type="application/ld+json">${babyFaqLd}</script>
<body class="theme">
${siteHeader()}
${siteNav('/babies/')}
<main class="container" id="main">

  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <a href="/babies/">赤ちゃん一覧</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">${esc(name)}</span>
  </nav>

  <article class="card ssg-detail" itemscope itemtype="https://schema.org/Animal">
    ${thumbHtml}
    <div class="ssg-detail__body">
      <h1 class="ssg-detail__name" itemprop="name">
        ${esc(name)}<span class="ssg-detail__species">（${esc(species)}）</span>
      </h1>
      <div class="ssg-detail__pills">
        <span class="pill pill--zoo">🏛️ ${esc(zoo)}</span>
        <span class="pill">🎂 ${esc(bdayFmt) || '—'}</span>
        <span class="pill pill--age-${ageSuffix(b.birthday)}">🎈 ${esc(age)}</span>
      </div>
      <p class="ssg-detail__desc">
        ${esc(zoo)}で${birthdayYear ? `${birthdayYear}年に` : ''}生まれた${esc(species)}の赤ちゃん「${esc(name)}」の情報ページです。
        誕生日は${esc(bdayFmt) || '不明'}、現在${esc(age)}。
      </p>
      ${babyEpisodeHtml}
      ${speciesInfoHtml}
      ${specsHtml}
      ${babyNewsHtml}
      ${babyFaqHtml}
      ${zooLinksHtml(zoo, name) || genericAsoviewCta()}
      <div class="ssg-detail__actions">
        <a class="btn btn--primary" href="/babies/">← 赤ちゃん一覧へ戻る</a>
      </div>
    </div>
  </article>

  ${sameZooHtml}
  ${sameSpeciesHtml}

  <!-- Google AdSense 広告（コンテンツ下部）-->
  ${ADSENSE_ENABLED ? `<div class="ad-wrap ad-wrap--labeled" aria-label="広告">
    <ins class="adsbygoogle adsense-slot"
         data-ad-client="${ADSENSE_CLIENT}"
         data-ad-slot="${ADSENSE_SLOT_BABY}"
         data-ad-format="auto"
         data-full-width-responsive="true"></ins>
    <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  </div>` : ''}

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
<script>
  // GA4: 赤ちゃん個別ページ閲覧イベント
  window.addEventListener('load', function () {
    if (typeof gtag === 'function') {
      gtag('event', 'baby_view', {
        animal_name: '${esc(name)}',
        animal_species: '${esc(species)}',
        zoo_name: '${esc(zoo)}',
      });
    }
  });
</script>
</body>
</html>`;
}

function babyRedirectHtml(slug) {
  const target = `${SITE_BASE}/babies/${slug}/`;
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8">
<link rel="canonical" href="${target}">
<meta http-equiv="refresh" content="0;url=/babies/${slug}/">
<title>移動しました | どうベビ</title>
</head><body>
<p><a href="/babies/${slug}/">こちら</a>へ移動しました。</p>
</body></html>`;
}

// ─── ニュース個別ページ ─────────────────────────────────────────────

function newsHtml(item) {
  const title     = item.title       || 'ニュース';
  const source    = item.source_name || '';
  const pubFmt    = fmtDate(item.published_at);
  const extUrl    = item.url || '#';
  const canonical = `${SITE_BASE}/news/${item.id}/`;

  const pageTitle = `${title} | どうベビ`;
  const desc = `${title}${source ? ` — ${source}` : ''}${pubFmt ? `（${pubFmt}）` : ''}。どうベビの動物園ベビーニュース。`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: desc,
    image: item.thumbnail_url || `${SITE_BASE}/assets/img/og.png`,
    url: extUrl,
    datePublished: item.published_at || undefined,
    publisher: {
      '@type': 'Organization',
      name: source || 'どうベビ',
      url: item.source_url || SITE_BASE,
    },
  });

  const thumbHtml = item.thumbnail_url
    ? `<img class="ssg-detail__img" src="${esc(item.thumbnail_url)}" alt="${esc(title)}" loading="eager" decoding="async">`
    : `<div class="ssg-detail__img ssg-detail__img--placeholder" role="img" aria-label="サムネイルなし">🗞️</div>`;

  // 外部 URL への rel 属性
  const isExternal = extUrl !== '#' && !extUrl.startsWith(SITE_BASE);
  const extAttrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title: pageTitle, desc, ogImage: item.thumbnail_url, canonical, jsonLd, robots: 'noindex,follow' })}
<body class="theme">
${siteHeader()}
${siteNav('/news/')}
<main class="container" id="main">

  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <a href="/news/">ニュース一覧</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">${esc(title.length > 50 ? title.slice(0, 50) + '…' : title)}</span>
  </nav>

  <article class="card ssg-detail">
    ${thumbHtml}
    <div class="ssg-detail__body">
      <h1 class="ssg-detail__title">${esc(title)}</h1>
      <div class="ssg-detail__pills">
        <span class="pill">📅 ${esc(pubFmt) || '—'}</span>
        ${source ? `<span class="pill pill--zoo">📰 ${esc(source)}</span>` : ''}
      </div>
      <p class="ssg-detail__desc">
        外部サイトの記事です。下のボタンから元記事をご確認ください。
      </p>
      <div class="ssg-detail__actions">
        <a class="btn btn--primary" href="${esc(extUrl)}"${extAttrs}>元記事を読む →</a>
        <a class="btn" href="/news/">← ニュース一覧へ</a>
      </div>
    </div>
  </article>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

// ─── 動物園個別ページ ───────────────────────────────────────────────

/**
 * 動物園の赤ちゃんカードHTML（一覧ページの赤ちゃんカードと同デザイン）
 */
// 公開状況バッジ（一般公開中／一般公開前）
function displayStatusBadge(status) {
  return status === 'pre'
    ? '<span class="pill" style="background:#fff4d6;color:#8a6d00;">\u{1F7E1} 近日公開</span>'
    : '<span class="pill" style="background:#e3f7ee;color:#0a7a5c;">\u{1F7E2} 公開中</span>';
}

function zooBabyCardHtml(b, slugMap = null) {
  const name     = b.name || '（名前未判明）';
  const species  = b.species || '';
  // 名前の中に既に種別が含まれている場合（旧データの '赤ちゃん（X）'）は種別を重複表示しない
  const showSpecies = species && !(b.name || '').includes(species);
  const bdayFmt  = fmtDate(b.birthday);
  const age      = ageText(b.birthday);
  const slug     = slugMap?.get(b.id) || b.id;
  const href     = `/babies/${slug}/`;
  const thumb    = b.thumbnail_url
    ? `<div class="thumb"><img src="${esc(b.thumbnail_url)}" loading="lazy" decoding="async" alt="${esc(name)}${showSpecies ? `（${esc(species)}）` : ''}"></div>`
    : `<div class="thumb is-placeholder" role="img" aria-label="画像なし"></div>`;

  return `<div class="baby-card">
    <a href="${href}" class="baby-card__link">
      ${thumb}
      <div class="pad">
        <div class="title">${esc(name)}${showSpecies ? `（${esc(species)}）` : ''}</div>
        <div class="meta">
          <span class="pill">🎂 ${esc(bdayFmt) || '—'}</span>
          <span class="pill pill--age-${ageSuffix(b.birthday)}">${esc(age)}</span>
          ${displayStatusBadge(b.display_status)}
        </div>
      </div>
    </a>${showSpecies ? `
    <a class="baby-card__species" href="/species/${esc(species)}/" style="display:block;padding:0 .75rem .6rem;font-size:.8rem;color:#0a7a5c;text-decoration:none;">\u{1F43E} ${esc(species)}の仲間をもっと見る →</a>` : ''}
  </div>`;
}

/**
 * 動物園個別ページ HTML
 */
/**
 * 動物園ページ固有の紹介文を在籍赤ちゃんデータから動的生成する。
 * 各園で内容が必ず変わるため重複コンテンツを避け、SEO上のオリジナリティを担保する。
 */
function zooStoryHtml(zoo, zooBabies) {
  const count = zooBabies.length;
  if (count === 0) return '';

  const speciesCount = {};
  for (const b of zooBabies) {
    const sp = b.species || '動物';
    speciesCount[sp] = (speciesCount[sp] || 0) + 1;
  }
  const speciesRanked = Object.entries(speciesCount).sort((a, b) => b[1] - a[1]);
  const speciesKinds = speciesRanked.length;
  const topSpecies = speciesRanked.slice(0, 3).map(([sp, n]) => n > 1 ? `${sp}（${n}頭）` : sp);

  const withBday = zooBabies.filter(b => b.birthday).sort((a, b) => String(b.birthday).localeCompare(String(a.birthday)));
  const newest = withBday[0] || null;
  const seasonOf = (iso) => {
    const m = new Date(iso).getMonth() + 1;
    if (m >= 3 && m <= 5)  return '春';
    if (m >= 6 && m <= 8)  return '夏';
    if (m >= 9 && m <= 11) return '秋';
    return '冬';
  };

  const endangered = [];
  for (const [sp] of speciesRanked) {
    const info = SPECIES_INFO[sp];
    if (info && /CR|EN|VU|絶滅|危急/.test(info.iucn || '')) endangered.push(sp);
  }

  const lines = [];
  lines.push(`${esc(zoo.prefecture)}${zoo.city ? esc(zoo.city) : ''}にある${esc(zoo.name)}では、現在${count}頭の動物の赤ちゃんが暮らしています。`);
  if (speciesKinds > 1) {
    lines.push(`${topSpecies.map(esc).join('・')}${speciesKinds > 3 ? `など全${speciesKinds}種類` : ''}の赤ちゃんに会うことができます。`);
  } else {
    lines.push(`${esc(topSpecies[0])}の赤ちゃんに会うことができます。`);
  }
  if (newest && newest.birthday) {
    const y = new Date(newest.birthday).getFullYear();
    lines.push(`もっとも新しく仲間入りしたのは${y}年${seasonOf(newest.birthday)}生まれの${esc(newest.species || '動物')}の赤ちゃん「${esc(newest.name)}」。すくすくと成長する姿が見られます。`);
  }
  if (endangered.length > 0) {
    lines.push(`なかでも${endangered.slice(0, 3).map(esc).join('・')}は野生での生息数が減少している希少種で、${esc(zoo.name)}での誕生は種の保全にとっても大切な一歩です。`);
  }
  lines.push(`赤ちゃんたちの誕生日・種類・最新の様子は、下記の一覧から各ページでご覧いただけます。お出かけの前にぜひチェックしてみてください。`);

  return `
  <section class="card zoo-section zoo-story" aria-labelledby="zoo-story-title">
    <header class="panel-head">
      <div class="panel-icon" aria-hidden="true"><svg class="panel-icon__svg" focusable="false"><use href="/assets/icons/icons.svg#icon-paw"></use></svg></div>
      <div>
        <h2 id="zoo-story-title" class="panel-title">${esc(zoo.name)}の赤ちゃんたち</h2>
      </div>
    </header>
    <div class="zoo-story__body" style="line-height:1.9;">
      ${lines.map(l => `<p>${l}</p>`).join('\n      ')}
    </div>
  </section>`;
}

function zooHtml(zoo, babies, slugMap = null) {
  const zooBabies = babies.filter(b => b.zoo_name === zoo.db_name);
  const count = zooBabies.length;
  // baby 0頭でも動物園情報(住所/営業/料金/FAQ)は十分なため index する（PROP-20260604-02）。0頭時は関連リンクで補強。
  const isThinZoo = count === 0;
  const sampleNames = zooBabies.slice(0, 3).map(b => b.name).filter(Boolean).join('・');

  // SEO: 「○○ 赤ちゃん」検索でヒットしやすい title（コアキーワード前置）
  const title = count > 0
    ? `${zoo.name}の赤ちゃん｜現在${count}頭・最新情報 | どうベビ`
    : `${zoo.name}の赤ちゃん情報 | どうベビ`;
  const desc = count > 0
    ? `${zoo.name}の赤ちゃん動物の最新情報。${sampleNames}${count > 3 ? 'など' : ''}${count}頭の赤ちゃんが暮らしています。誕生日・種類・写真をまとめて掲載。${zoo.description ? zoo.description.slice(0, 60) : ''}`.slice(0, 160)
    : `${zoo.name}の赤ちゃん動物情報。入園料・営業時間・アクセスもまとめて掲載。${zoo.description || ''}`.slice(0, 160);
  const canonical = `${SITE_BASE}/zoos/${zoo.slug}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Zoo',
    name: zoo.name,
    description: zoo.description || desc,
    url: canonical,
    image: `${SITE_BASE}/assets/img/og.png`,
    sameAs: zoo.official_url ? [zoo.official_url] : undefined,
    address: {
      '@type': 'PostalAddress',
      addressRegion: zoo.prefecture,
      addressLocality: zoo.city,
      streetAddress: zoo.address,
      addressCountry: 'JP',
    },
    openingHours: zoo.hours,
  });

  // BreadcrumbList JSON-LD（パンくず構造化）
  const zooBreadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: '動物園一覧', item: `${SITE_BASE}/zoos/` },
      { '@type': 'ListItem', position: 3, name: zoo.name, item: canonical },
    ],
  });

  // FAQPage JSON-LD（よくある質問）— Google 検索結果に展開表示される可能性
  const zooFaqLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `${zoo.name}には現在どんな赤ちゃん動物がいますか？`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: count > 0
            ? `${zoo.name}には現在${count}頭の赤ちゃん動物が暮らしています。${sampleNames ? `代表的なのは${sampleNames}${count > 3 ? 'など' : ''}` : ''}。最新の誕生情報は本ページで随時更新しています。`
            : `現在${zoo.name}の赤ちゃん動物の登録はありません。新しい情報が入り次第このページで掲載します。`,
        },
      },
      ...(zoo.hours ? [{
        '@type': 'Question',
        name: `${zoo.name}の営業時間を教えてください。`,
        acceptedAnswer: { '@type': 'Answer', text: zoo.hours.replace(/\n/g, ' / ') },
      }] : []),
      ...(zoo.fees ? [{
        '@type': 'Question',
        name: `${zoo.name}の入園料はいくらですか？`,
        acceptedAnswer: { '@type': 'Answer', text: zoo.fees.replace(/\n/g, ' / ') },
      }] : []),
      ...(zoo.nearest_station ? [{
        '@type': 'Question',
        name: `${zoo.name}へのアクセス方法は？`,
        acceptedAnswer: { '@type': 'Answer', text: zoo.nearest_station.replace(/\n/g, ' / ') },
      }] : []),
    ],
  });

  const zooExtraJsonLd = `<script type="application/ld+json">${zooBreadcrumbLd}</script><script type="application/ld+json">${zooFaqLd}</script>`;

  // アフィリエイト / 公式リンク
  const svgTicket2 = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-ticket"></use></svg>`;
  const svgMapPin2 = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-map-pin"></use></svg>`;
  const ticketBtn = zoo.asoview_url
    ? `<a class="zoo-link zoo-link--ticket"
           href="${esc(zoo.asoview_url)}"
           target="_blank" rel="noopener sponsored"
           data-link-type="ticket"
           data-zoo-name="${esc(zoo.db_name)}">
        🎟️ チケットを事前予約 <small class="zoo-link__pr">広告</small>
      </a>`
    : `<a class="zoo-link zoo-link--ticket"
           href="${asoviewAffiliate()}"
           target="_blank" rel="noopener sponsored"
           data-link-type="ticket-generic"
           data-zoo-name="${esc(zoo.db_name)}">
        🎟️ チケットを事前予約 <small class="zoo-link__pr">広告</small>
      </a>`;
  const officialBtn = zoo.official_url
    ? `<a class="zoo-link zoo-link--official"
           href="${esc(zoo.official_url)}"
           target="_blank" rel="noopener noreferrer"
           data-link-type="official"
           data-zoo-name="${esc(zoo.db_name)}">
        ${svgMapPin2} 公式サイトはこちら
      </a>`
    : '';

  const babiesGrid = count > 0
    ? `<div class="baby-grid">${zooBabies.map(b => zooBabyCardHtml(b, slugMap)).join('')}</div>`
    : `<div class="empty-state">
         <p class="empty-state__title">現在、${esc(zoo.name)}の赤ちゃん情報はありません</p>
         <p class="empty-state__desc">また新しい情報が入り次第掲載します。</p>
       </div>`;

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd, extraJsonLd: zooExtraJsonLd })}
<body class="theme">
${siteHeader()}
${siteNav('/zoos/')}
<main class="container" id="main">

  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <a href="/zoos/">動物園一覧</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">${esc(zoo.name)}</span>
  </nav>

  <section class="zoo-hero">
    <div class="zoo-hero__emoji" aria-hidden="true">${zoo.hero_emoji || '🏛️'}</div>
    <div class="zoo-hero__body">
      <p class="zoo-hero__region">${esc(zoo.prefecture)} ${esc(zoo.city)}</p>
      <h1 class="zoo-hero__title">${esc(zoo.name)}の赤ちゃん動物</h1>
      <p class="zoo-hero__count">現在 <strong>${count}</strong> 頭の赤ちゃんが暮らしています</p>
    </div>
  </section>

  ${zoo.description ? `
  <section class="card zoo-section">
    <header class="panel-head">
      <div class="panel-icon" aria-hidden="true"><svg class="panel-icon__svg" focusable="false"><use href="/assets/icons/icons.svg#icon-pencil"></use></svg></div>
      <div>
        <h2 class="panel-title">${esc(zoo.name)}について</h2>
      </div>
    </header>
    <p class="zoo-desc">${esc(zoo.description)}</p>
  </section>` : ''}

  ${zooStoryHtml(zoo, zooBabies)}

  <section class="card zoo-section" aria-labelledby="zoo-babies-title">
    <header class="panel-head">
      <div class="panel-icon" aria-hidden="true"><svg class="panel-icon__svg" focusable="false"><use href="/assets/icons/icons.svg#icon-paw"></use></svg></div>
      <div>
        <h2 id="zoo-babies-title" class="panel-title">${esc(zoo.name)}の赤ちゃん一覧</h2>
        <p class="panel-desc">${count}頭の赤ちゃん</p>
      </div>
    </header>
    ${babiesGrid}
  </section>

  ${isThinZoo ? `<section class="card zoo-section">
    <header class="panel-head">
      <div class="panel-icon" aria-hidden="true"><svg class="panel-icon__svg" focusable="false"><use href="/assets/icons/icons.svg#icon-paw"></use></svg></div>
      <div>
        <h2 class="panel-title">他の動物園・動物の赤ちゃんを探す</h2>
        <p class="panel-desc">${esc(zoo.name)}の赤ちゃん情報は入り次第掲載します。今会える赤ちゃんはこちら。</p>
      </div>
    </header>
    <p style="display:flex;flex-wrap:wrap;gap:0.6rem;margin:0;">
      <a class="dbb-cta" href="/zoos/">動物園一覧から探す →</a>
      <a class="dbb-cta" href="/babies/">今いる赤ちゃんを見る →</a>
      <a class="dbb-cta" href="/species/">動物の種類から探す →</a>
    </p>
  </section>` : ''}

  <section class="card zoo-section" aria-labelledby="zoo-info-title">
    <header class="panel-head">
      <div class="panel-icon" aria-hidden="true"><svg class="panel-icon__svg" focusable="false"><use href="/assets/icons/icons.svg#icon-info"></use></svg></div>
      <div>
        <h2 id="zoo-info-title" class="panel-title">基本情報・アクセス</h2>
      </div>
    </header>
    <dl class="zoo-info">
      ${zoo.address ? `<div class="zoo-info__row"><dt>📍 住所</dt><dd>${esc(zoo.address)}</dd></div>` : ''}
      ${zoo.nearest_station ? `<div class="zoo-info__row"><dt>🚃 アクセス</dt><dd>${esc(zoo.nearest_station).replace(/\n/g, '<br>')}</dd></div>` : ''}
      ${zoo.hours ? `<div class="zoo-info__row"><dt>🕘 営業時間</dt><dd>${esc(zoo.hours).replace(/\n/g, '<br>')}</dd></div>` : ''}
      ${zoo.closed_days ? `<div class="zoo-info__row"><dt>📅 休園日</dt><dd>${esc(zoo.closed_days)}</dd></div>` : ''}
      ${zoo.fees ? `<div class="zoo-info__row"><dt>💴 入園料</dt><dd>${esc(zoo.fees).replace(/\n/g, '<br>')}</dd></div>` : ''}
    </dl>
    <div class="zoo-links">
      ${ticketBtn}
      ${officialBtn}
    </div>
    <p class="zoo-link__note">アソビュー（正規取扱）｜お支払額は当日窓口と変わりません</p>
  </section>

  <div class="ssg-detail__actions">
    <a class="btn" href="/zoos/">← 動物園一覧へ戻る</a>
  </div>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
<script>
  window.addEventListener('load', function () {
    if (typeof gtag === 'function') {
      gtag('event', 'zoo_view', {
        zoo_name: '${esc(zoo.db_name)}',
        zoo_slug: '${esc(zoo.slug)}',
        baby_count: ${count},
      });
    }
  });
</script>
</body>
</html>`;
}

/**
 * 動物園一覧ページ HTML（都道府県別）
 */
function zooIndexHtml(babies) {
  const groups = groupByPrefecture(ZOOS);
  const countByDbName = new Map();
  for (const b of babies) {
    if (!b.zoo_name) continue;
    countByDbName.set(b.zoo_name, (countByDbName.get(b.zoo_name) || 0) + 1);
  }

  const title = '動物園一覧（都道府県別）| どうベビ';
  const desc = `日本全国の動物園${ZOOS.length}園を都道府県別に一覧掲載。各動物園で現在会える赤ちゃん動物の数もひと目でわかります。`;
  const canonical = `${SITE_BASE}/zoos/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '動物園一覧',
    description: desc,
    url: canonical,
  });

  const prefSlug = pref => pref.replace(/[都道府県]/g, '').replace(/\s/g, '');

  const sections = groups.map(g => {
    const cards = g.zoos.map(z => {
      const n = countByDbName.get(z.db_name) || 0;
      return `<a class="zoo-card" href="/zoos/${esc(z.slug)}/">
        <div class="zoo-card__emoji" aria-hidden="true">${z.hero_emoji || '🏛️'}</div>
        <div class="zoo-card__body">
          <p class="zoo-card__region">${esc(z.city)}</p>
          <h3 class="zoo-card__name">${esc(z.name)}</h3>
          <span class="zoo-card__badge${n > 0 ? ' zoo-card__badge--active' : ''}">🐣 赤ちゃん ${n}頭</span>
        </div>
      </a>`;
    }).join('');
    return `<section class="zoo-prefecture" id="pref-${prefSlug(g.prefecture)}">
      <h2 class="zoo-prefecture__title">${esc(g.prefecture)}</h2>
      <div class="zoo-card-grid">${cards}</div>
    </section>`;
  }).join('');

  const jumpLinks = groups.map(g =>
    `<a class="zoo-jump__link" href="#pref-${prefSlug(g.prefecture)}">${esc(g.prefecture)}</a>`
  ).join('');

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<body class="theme">
${siteHeader()}
${siteNav('/zoos/')}
<main class="container" id="main">

  <section class="page-hero">
    <h1 class="page-title">動物園一覧（都道府県別）</h1>
    <p class="page-subtitle">全国 ${ZOOS.length} 園の動物園を掲載中</p>
    <p style="text-align:center;margin:.6rem 0 0;"><a class="dbb-cta" href="/area/">地域・エリアから赤ちゃんを探す →</a></p>
  </section>

  <nav class="zoo-jump" aria-label="都道府県ジャンプ">
    ${jumpLinks}
  </nav>

  ${sections}

  ${genericAsoviewCta()}
</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

// ─── 赤ちゃん一覧ページ（SSG） ──────────────────────────────────────

/**
 * /babies/index.html — クローラー向けに最大48件を事前レンダリング
 * 通常ユーザーはJS（babies.js）が最新データで上書きするため動的体験は維持される
 */
function babiesIndexHtml(babies, slugMap = null) {
  const preview = babies.slice(0, 48);
  const total   = babies.length;

  const title    = `赤ちゃん一覧（全${total}頭）| どうベビ`;
  const desc     = `日本の動物園にいる赤ちゃん動物を一覧表示。現在${total}頭を掲載中。名前・種・誕生日・所属動物園で検索できます。`;
  const canonical = `${SITE_BASE}/babies/`;
  const jsonLd   = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '赤ちゃん一覧',
    description: desc,
    url: canonical,
    numberOfItems: total,
  });

  const cards = preview.map(b => {
    const name       = b.name || '（名前未判明）';
    const species    = b.species || '';
    const zoo        = b.zoo_name || '';
    const showSpecies = species && !name.includes(species);
    const thumb = b.thumbnail_url
      ? `<div class="thumb"><img src="${esc(b.thumbnail_url)}" loading="lazy" decoding="async" alt="${esc(name)}"></div>`
      : `<div class="thumb is-placeholder" role="img" aria-label="画像なし"></div>`;
    const bSlug = slugMap?.get(b.id) || b.id;
    return `<div class="baby-card">
        <a href="/babies/${esc(bSlug)}/" class="baby-card__link" aria-label="${esc(name)}（${esc(species || '種別不明')}、${esc(zoo || '園情報なし')}）の詳細">
          ${thumb}
          <div class="pad">
            <div class="title">${esc(name)}${showSpecies ? `（${esc(species)}）` : ''}</div>
            <div class="meta">
              <span class="pill">${esc(zoo)}</span>
              <span class="pill">🎂 ${fmtDate(b.birthday) || '—'}</span>
            </div>
          </div>
        </a>
      </div>`;
  }).join('\n      ');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE_BASE}/assets/img/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml" />
  <meta name="google-site-verification" content="yqP_OZz3Qm_iPw3wLSlhofOmYHwrFf3CyU7psadeE-U" />
  <meta name="google-adsense-account" content="ca-pub-7279120932069417">
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="/assets/css/style.css" />
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body class="theme" data-page-size="12">
${siteHeader()}
${siteNav('/babies/')}
<main class="container">
  <section class="page-hero"><h1 class="page-title">赤ちゃん一覧 ― いま会いに行ける</h1></section>

  <div id="controls" class="controls sticky" role="region" aria-label="検索と絞り込み">
    <input id="q" type="search" placeholder="名前・動物種・園名で検索" aria-label="名前・動物種・園名で検索">
    <select id="zoo" aria-label="所属動物園で絞り込み"><option value="">すべての動物園</option></select>
    <select id="sort" aria-label="並び替え">
      <option value="desc" selected>誕生日が新しい順</option>
      <option value="asc">誕生日が古い順</option>
      <option value="near">誕生日が近い順</option>
    </select>
  </div>

  <div class="age-filter segmented" role="radiogroup" aria-label="年齢で絞り込み">
    <button type="button" class="segmented__btn is-selected" data-age="" aria-checked="true" role="radio">すべて</button>
    <button type="button" class="segmented__btn" data-age="0" aria-checked="false" role="radio">0歳</button>
    <button type="button" class="segmented__btn" data-age="1" aria-checked="false" role="radio">1歳</button>
    <button type="button" class="segmented__btn" data-age="2" aria-checked="false" role="radio">2歳</button>
    <button type="button" class="segmented__btn" data-age="3" aria-checked="false" role="radio">3歳</button>
  </div>

  <!-- SSG事前レンダリング: JS読み込み後は babies.js が最新データで上書き -->
  <div id="skeleton-babies" class="baby-grid" aria-hidden="true" style="display:none"></div>
  <div id="error" role="alert" style="display:none"></div>
  <div id="list" class="baby-grid" aria-live="polite" data-ssg-count="${preview.length}">
    ${cards}
  </div>
  <div id="empty" style="display:none;">
    <div class="empty-state">
      <p class="empty-state__title">赤ちゃんが見つかりませんでした</p>
      <p class="empty-state__desc">検索条件を変えて試してみてください</p>
    </div>
  </div>
  <div class="more-wrap"><button id="more" type="button" style="display:none;">もっと読む</button></div>

  ${genericAsoviewCta()}
</main>
${siteFooter()}
<script defer src="/assets/js/app.js"></script>
<script defer src="/assets/js/babies.js"></script>
<script defer src="/assets/js/analytics.js"></script>
<script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js" crossorigin="anonymous"></script>
<script>document.addEventListener('DOMContentLoaded',function(){if(window.twemoji)twemoji.parse(document.body,{folder:'svg',ext:'.svg',base:'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/'});});</script>
</body>
</html>`;
}

// ─── ニュース一覧ページ（SSG） ──────────────────────────────────────

/**
 * /news/index.html — クローラー向けに最大36件を事前レンダリング
 */
function newsIndexHtml(newsItems) {
  const preview = newsItems.slice(0, 36);
  const total   = newsItems.length;

  const title    = `ニュース一覧（${total}件）| どうベビ`;
  const desc     = `日本の動物園の赤ちゃん動物ニュースを一覧でチェック。公式サイト・ブログ・YouTubeなどをまとめて表示します。現在${total}件掲載中。`;
  const canonical = `${SITE_BASE}/news/`;
  const jsonLd   = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'ニュース一覧',
    description: desc,
    url: canonical,
    numberOfItems: total,
  });

  const fmtShort = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  };

  const cards = preview.map(item => {
    const thumbHtml = item.thumbnail_url
      ? `<img src="${esc(item.thumbnail_url)}" alt="" loading="lazy" decoding="async">`
      : '';
    const date = fmtShort(item.published_at);
    return `<a class="news-card" href="${esc(item.url || '#')}" target="_blank" rel="noopener noreferrer">
        <div class="thumb">${thumbHtml}</div>
        <div class="pad">
          <div class="title">${esc(item.title || '(無題)')}</div>
          <div class="meta">
            <span>${esc(date)}</span>
            ${item.source_name ? `<span class="dot"></span><span>${esc(item.source_name)}</span>` : ''}
          </div>
        </div>
      </a>`;
  }).join('\n      ');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,follow" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE_BASE}/assets/img/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml" />
  <meta name="google-site-verification" content="yqP_OZz3Qm_iPw3wLSlhofOmYHwrFf3CyU7psadeE-U" />
  <meta name="google-adsense-account" content="ca-pub-7279120932069417">
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="/assets/css/style.css" />
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');</script>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body class="theme" data-news-v2="1" data-page-size="12">
${siteHeader()}
${siteNav('/news/')}
<main class="container">
  <section class="page-hero"><h1 class="page-title">ニュース一覧</h1></section>

  <div class="controls sticky" role="region" aria-label="検索と絞り込み">
    <input id="q" type="search" placeholder="タイトル / ソース名で検索">
    <select id="source">
      <option value="">すべてのソース</option>
      <option value="YouTube">YouTube</option>
      <option value="blog">ブログ/ニュース</option>
      <option value="公式記事">公式記事（このサイト）</option>
    </select>
    <select id="sort"><option value="desc" selected>新着順</option><option value="asc">古い順</option></select>
  </div>

  <!-- SSG事前レンダリング: JS読み込み後は news.js が最新データで上書き -->
  <div id="skeleton-news" class="news-grid" aria-hidden="true" style="display:none"></div>
  <div id="error" role="alert" style="display:none"></div>
  <div id="list" class="news-grid" aria-live="polite" data-ssg-count="${preview.length}">
    ${cards}
  </div>
  <div id="empty" style="display:none;">
    <div class="empty-state">
      <p class="empty-state__title">ニュースが見つかりませんでした</p>
      <p class="empty-state__desc">検索条件を変えて試してみてください</p>
    </div>
  </div>
  <div class="more-wrap"><button id="more" type="button">もっと読む</button></div>
</main>
${siteFooter()}
<script defer src="/assets/js/app.js"></script>
<script defer src="/assets/js/news.js"></script>
<script defer src="/assets/js/analytics.js"></script>
<script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js" crossorigin="anonymous"></script>
<script>document.addEventListener('DOMContentLoaded',function(){if(window.twemoji)twemoji.parse(document.body,{folder:'svg',ext:'.svg',base:'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/'});});</script>
</body>
</html>`;
}




// ─── 動物種別ページ（SSG） ──────────────────────────────────────

function speciesHtml(species, babies, slugMap) {
  const info = SPECIES_INFO[species] || null;
  const otherSpecies = [...new Set(babies.map(b => b.species).filter(s => s && s !== species))].sort().slice(0, 12);
  const otherSpeciesLinks = otherSpecies.length ? `<section style="margin:1.5rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 1rem;">\u{1F43E} ほかの動物の赤ちゃんも見る</h2>
    <div style="display:flex;flex-wrap:wrap;gap:.5rem;">${otherSpecies.map(s => `<a href="/species/${esc(s)}/" style="display:inline-block;padding:.35rem .8rem;background:#f0f7f4;border-radius:999px;font-size:.9rem;color:#0a7a5c;text-decoration:none;">${esc(s)}</a>`).join('')}</div>
    <p style="margin:1rem 0 0;font-size:.95rem;"><a href="/specials/endangered/">絶滅危惧種の赤ちゃん特集</a> ・ <a href="/species/">すべての種を見る</a></p>
  </section>` : '';
  const speciesBabies = babies.filter(b => b.species === species);
  const count = speciesBabies.length;
  const sampleNames = speciesBabies.slice(0, 3).map(b => b.name).filter(Boolean).join('・');
  const zooSet = new Set(speciesBabies.map(b => b.zoo_name).filter(Boolean));
  const slug = encodeURI(species);  // 日本語URL用（% は二重エンコード防止のため使わない）

  const title = `${species}の赤ちゃん（${zooSet.size}園・${count}頭）| どうベビ`;
  const desc = (count > 0
    ? `動物園にいる${species}の赤ちゃんをまとめて紹介。${sampleNames}${count > 3 ? 'など' : ''}${count}頭が全国${zooSet.size}園で暮らしています。${info ? info.desc.slice(0, 80) + '…' : ''}`
    : `${species}の赤ちゃんを動物園で探す。${info ? info.desc.slice(0, 140) + '…' : ''}`
  ).slice(0, 160);
  const canonical = `${SITE_BASE}/species/${slug}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${species}の赤ちゃん`,
    description: desc,
    url: canonical,
    image: `${SITE_BASE}/assets/img/og.png`,
    inLanguage: 'ja',
    isPartOf: { '@type': 'WebSite', name: 'どうベビ', url: SITE_BASE },
    about: {
      '@type': 'Animal',
      name: species,
      description: info ? info.desc : `${species}の赤ちゃん情報`,
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: speciesBabies.length,
      itemListElement: speciesBabies.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_BASE}/babies/${slugMap?.get(b.id) || b.id}/`,
        name: b.name || species,
      })),
    },
  });

  // 見頃（在籍個体の月齢から動的生成）
  const datedBabies = speciesBabies.filter(b => b.birthday).sort((a, b) => b.birthday.localeCompare(a.birthday));
  const youngest = datedBabies[0];
  const viewingAnswer = youngest
    ? `最も新しい${species}の赤ちゃんは${youngest.zoo_name ? youngest.zoo_name + 'の' : ''}「${youngest.name || '赤ちゃん'}」（${ageText(youngest.birthday)}）です。赤ちゃんの時期は短く、成長すると見た目も大きく変わります。会いたい子がいるうちに足を運ぶのがおすすめです。`
    : '';

  // FAQ項目（JSON-LD と 画面表示で共用）
  const faqItems = [
    {
      q: `${species}の赤ちゃんはどこの動物園で会えますか？`,
      a: zooSet.size > 0
        ? `現在、${species}の赤ちゃんは全国${zooSet.size}園で会えます。${Array.from(zooSet).slice(0, 5).join('・')}${zooSet.size > 5 ? 'など' : ''}で飼育されています。`
        : `現在、${species}の赤ちゃんの登録はありません。新しい情報が入り次第このページで掲載します。`,
    },
    ...(viewingAnswer ? [{ q: `${species}の赤ちゃんの見頃はいつですか？`, a: viewingAnswer }] : []),
    ...(info ? [{ q: `${species}はどんな動物ですか？`, a: info.desc }] : []),
    ...(info ? [{ q: `${species}の保全状況（IUCN）はどうなっていますか？`, a: `${species}は IUCN レッドリストで「${info.iucn}」に指定されています。野生での生息環境を守る取り組みとあわせて、動物園での飼育・繁殖も種の保全に役立っています。` }] : []),
    { q: `${species}の赤ちゃんを見るときのコツはありますか？`, a: `赤ちゃんは午前中の涼しい時間帯に活発なことが多く、授乳や親子の様子を観察できます。公開時間や展示場所は季節や体調によって変わるため、おでかけ前に各動物園の公式サイトやSNSで当日の展示状況を確認すると安心です。前売り券を用意しておくと当日スムーズに入園できます。` },
  ];

  const speciesFaqLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(it => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  });

  const visibleFaqHtml = `<section style="margin:1.5rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 1rem;">\u{2753} ${esc(species)}の赤ちゃん よくある質問</h2>
    ${faqItems.map(it => `<details style="margin:0 0 .6rem;padding:.8rem 1rem;background:rgba(255,255,255,0.6);border-radius:10px;">
      <summary style="cursor:pointer;font-weight:600;line-height:1.5;">${esc(it.q)}</summary>
      <p style="margin:.6rem 0 0;line-height:1.7;">${esc(it.a)}</p>
    </details>`).join('')}
  </section>`;

  const speciesExtraJsonLd = `<script type="application/ld+json">${speciesFaqLd}</script>`;

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: '動物種別', item: `${SITE_BASE}/species/` },
      { '@type': 'ListItem', position: 3, name: species, item: canonical },
    ],
  });

  const cards = speciesBabies.map(b => zooBabyCardHtml(b, slugMap)).join('');
  const zoosList = Array.from(zooSet).sort().map(zn => {
    const z = ZOOS.find(x => x.db_name === zn);
    if (!z) return `<li>${esc(zn)}</li>`;
    return `<li><a href="/zoos/${esc(z.slug)}/">${esc(z.name)}</a></li>`;
  }).join('');

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd, extraJsonLd: speciesExtraJsonLd })}
<script type="application/ld+json">${breadcrumbLd}</script>
<body class="theme">
${siteHeader()}
${siteNav('/babies/')}
<main class="container" id="main">
  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <a href="/species/">動物種別</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">${esc(species)}</span>
  </nav>
  <section class="page-hero">
    <h1 class="page-title">${esc(species)}の赤ちゃん</h1>
    <p class="page-subtitle">${count}頭・${zooSet.size}園で会える</p>
  </section>

  ${info ? `<section class="species-info" style="margin:1.5rem 0;padding:1rem;background:rgba(255,255,255,0.6);border-radius:12px;">
    <p style="margin:0 0 0.5rem;font-size:0.9rem;color:#666;">🌿 IUCNレッドリスト: <strong>${esc(info.iucn)}</strong></p>
    <p style="margin:0;line-height:1.7;">${esc(info.desc)}</p>
  </section>` : ''}

  <section style="margin:1.5rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 1rem;">🐣 ${esc(species)}の赤ちゃん一覧</h2>
    <div class="baby-grid">${cards || '<p>現在登録された赤ちゃん情報はありません。</p>'}</div>
  </section>

  ${zoosList ? `<section style="margin:1.5rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 1rem;">🏛️ ${esc(species)}に会える動物園</h2>
    <ul style="list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.5rem;">${zoosList}</ul>
  </section>` : ''}

  ${visibleFaqHtml}

  ${genericAsoviewCta(`${esc(species)}に会える動物園の電子チケット。当日窓口と同じ料金で、並ばず入園できます。`)}

  ${otherSpeciesLinks}

  <p style="text-align:center;margin:2rem 0;"><a class="dbb-cta" href="/babies/">全ての赤ちゃんを見る →</a></p>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

// ─── 地域（エリア）別ハブ（SSG） PROP-20260607-03 検索需要ハブ ──────────
const REGIONS = [
  ['北海道', ['北海道']],
  ['東北', ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']],
  ['関東', ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']],
  ['中部', ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県']],
  ['近畿', ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県']],
  ['中国', ['鳥取県', '島根県', '岡山県', '広島県', '山口県']],
  ['四国', ['徳島県', '香川県', '愛媛県', '高知県']],
  ['九州・沖縄', ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']],
];

function areaRegionData(babies) {
  const prefRegion = {};
  REGIONS.forEach(([rn, prefs]) => prefs.forEach(p => { prefRegion[p] = rn; }));
  const regionMap = new Map();
  for (const b of babies) {
    const rn = prefRegion[b.prefecture];
    if (!rn || !b.zoo_name) continue;
    if (!regionMap.has(rn)) regionMap.set(rn, new Map());
    const zm = regionMap.get(rn);
    if (!zm.has(b.zoo_name)) zm.set(b.zoo_name, { pref: b.prefecture, babies: [] });
    zm.get(b.zoo_name).babies.push(b);
  }
  const order = REGIONS.map(([rn]) => rn).filter(rn => regionMap.has(rn));
  return { regionMap, order };
}

function areaZooBlocks(zm, slugMap) {
  const zooSlug = (name) => { const z = ZOOS.find(x => x.db_name === name); return z ? z.slug : null; };
  const zoos = [...zm.entries()].sort((a, b) => b[1].babies.length - a[1].babies.length);
  return zoos.map(([zname, x]) => {
    const slug = zooSlug(zname);
    const head = slug
      ? `<a href="/zoos/${esc(slug)}/" style="font-weight:700;color:#0a7a5c;text-decoration:none;">${esc(zname)}</a>`
      : `<span style="font-weight:700;">${esc(zname)}</span>`;
    const babyLinks = x.babies.map(b => `<a href="/babies/${esc(slugMap?.get(b.id) || b.id)}/" style="display:inline-block;margin:.15rem .3rem .15rem 0;padding:.2rem .6rem;background:#f4f7f6;border-radius:999px;color:#0a7a5c;text-decoration:none;font-size:.85rem;">${esc(b.name || '赤ちゃん')}${b.species ? `<span style="opacity:.6;">（${esc(b.species)}）</span>` : ''}</a>`).join('');
    return `<div style="margin:0 0 1rem;">
      <div>${head} <span style="color:#888;font-size:.85rem;">${esc(x.pref)}・${x.babies.length}頭</span></div>
      <div style="margin-top:.3rem;">${babyLinks}</div>
    </div>`;
  }).join('');
}

// /area/ ハブ：8地域への入口（PROP-20260608-03 ③ エリア別個別ページ化）
function areaIndexHtml(babies, slugMap, areaData) {
  const { regionMap, order } = areaData || areaRegionData(babies);
  const totalBabies = babies.length;
  const title = `地域・エリアから動物の赤ちゃんを探す | どうベビ`;
  const desc = `関東・近畿・九州など全国のエリア別に、いま動物園で会える赤ちゃんをまとめて紹介。お近くの動物園で会える${totalBabies}頭の赤ちゃんを地域から探せます。`;
  const canonical = `${SITE_BASE}/area/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'エリア別 赤ちゃん一覧', description: desc, url: canonical, inLanguage: 'ja',
    isPartOf: { '@type': 'WebSite', name: 'どうベビ', url: SITE_BASE },
  });
  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'エリアから探す', item: canonical },
    ],
  });
  const cards = order.map(rn => {
    const zm = regionMap.get(rn);
    const total = [...zm.values()].reduce((t, x) => t + x.babies.length, 0);
    const sp = new Set(); zm.forEach(x => x.babies.forEach(b => b.species && sp.add(b.species)));
    return `<a href="/area/${encodeURI(rn)}/" style="display:block;padding:1rem 1.2rem;background:#fff;border:1px solid #d6efe4;border-radius:14px;text-decoration:none;color:inherit;">
      <div style="font-size:1.15rem;font-weight:800;color:#0a7a5c;">${esc(rn)}で会える赤ちゃん</div>
      <div style="margin-top:.3rem;color:#666;font-size:.9rem;">${zm.size}園・${total}頭・${sp.size}種 ›</div>
    </a>`;
  }).join('');
  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<script type="application/ld+json">${breadcrumbLd}</script>
<body class="theme">
${siteHeader()}
${siteNav('/zoos/')}
<main class="container" id="main">
  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">エリアから探す</span>
  </nav>
  <section class="page-hero">
    <h1 class="page-title">地域・エリアから赤ちゃんを探す</h1>
    <p class="page-subtitle">いま全国${totalBabies}頭の赤ちゃんに会えます</p>
  </section>
  <p style="line-height:1.7;margin:1rem 0;">お住まいの地域や旅行先で、いま動物園・水族館に会いに行ける赤ちゃんをエリア別にまとめました。気になる地域を選んで、会える赤ちゃんと動物園を探してみましょう。</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.8rem;margin:1.2rem 0;">${cards}</div>
  ${genericAsoviewCta('お近くの動物園・水族館の電子チケット。当日窓口と同じ料金で、並ばず入園。')}
  <p style="text-align:center;margin:2rem 0;"><a class="dbb-cta" href="/species/">動物の種類から探す →</a></p>
</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

// /area/{地域}/ 個別ページ（PROP-20260608-03 ③）
function areaRegionHtml(rn, zm, totalBabies, slugMap, order) {
  const regionTotal = [...zm.values()].reduce((t, x) => t + x.babies.length, 0);
  const regionSp = new Set(); zm.forEach(x => x.babies.forEach(b => b.species && regionSp.add(b.species)));
  const prefSet = new Set([...zm.values()].map(x => x.pref).filter(Boolean));
  const canonical = `${SITE_BASE}/area/${encodeURI(rn)}/`;
  const title = `${rn}の動物園で会える赤ちゃん｜会える動物園とベビーまとめ | どうベビ`;
  const desc = `${rn}の動物園・水族館でいま会える赤ちゃんを${zm.size}園・${regionTotal}頭まとめて紹介。${[...regionSp].slice(0, 4).join('・')}など。お出かけ先選びの参考にどうぞ。`.slice(0, 160);
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: `${rn}で会える動物園の赤ちゃん`, description: desc, url: canonical, inLanguage: 'ja',
    isPartOf: { '@type': 'WebSite', name: 'どうベビ', url: SITE_BASE },
  });
  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: 'エリアから探す', item: `${SITE_BASE}/area/` },
      { '@type': 'ListItem', position: 3, name: rn, item: canonical },
    ],
  });
  const faqItems = [
    { q: `${rn}で今どんな赤ちゃんに会えますか？`, a: `このページに${rn}の動物園・水族館で会える赤ちゃんを園ごとにまとめています。気になる動物園のページから、公開状況や見どころを確認できます。` },
    { q: '予約やチケットは必要ですか？', a: '多くの動物園は当日入園できますが、前売り券を用意しておくと当日スムーズです。混雑期は入場制限がある園もあるため、公式サイトで最新情報を確認してからのお出かけが安心です。' },
    { q: '赤ちゃんは必ず見られますか？', a: '赤ちゃんは体調や月齢により非公開・公開前のことがあります。各動物園ページや公式サイトで公開状況を確認してからのお出かけをおすすめします。' },
  ];
  const faqLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqItems.map(it => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })),
  });
  const visibleFaq = `<section style="margin:2rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 1rem;">❓ ${esc(rn)}のお出かけ前によくある質問</h2>
    ${faqItems.map(it => `<details style="margin:0 0 .6rem;padding:.8rem 1rem;background:rgba(255,255,255,0.6);border-radius:10px;">
      <summary style="cursor:pointer;font-weight:600;line-height:1.5;">${esc(it.q)}</summary>
      <p style="margin:.6rem 0 0;line-height:1.7;">${esc(it.a)}</p>
    </details>`).join('')}
  </section>`;
  const otherRegions = (order || []).filter(x => x !== rn).map(x => `<a href="/area/${encodeURI(x)}/" style="display:inline-block;padding:.35rem .8rem;margin:.2rem;background:#f0f7f4;border-radius:999px;color:#0a7a5c;text-decoration:none;font-size:.9rem;">${esc(x)}</a>`).join('');
  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<script type="application/ld+json">${breadcrumbLd}</script>
<script type="application/ld+json">${faqLd}</script>
<body class="theme">
${siteHeader()}
${siteNav('/zoos/')}
<main class="container" id="main">
  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <a href="/area/">エリアから探す</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">${esc(rn)}</span>
  </nav>
  <section class="page-hero">
    <h1 class="page-title">${esc(rn)}で会える動物園の赤ちゃん</h1>
    <p class="page-subtitle">${zm.size}園・${regionTotal}頭・${regionSp.size}種に会えます</p>
  </section>
  <p style="line-height:1.7;margin:1rem 0;">${esc(rn)}（${[...prefSet].slice(0, 8).map(esc).join('・')}）の動物園・水族館で、いま会いに行ける赤ちゃんをまとめました。気になる動物園を見つけて、会いに行く参考にどうぞ。</p>
  <section style="margin:1.5rem 0;">
    ${areaZooBlocks(zm, slugMap)}
  </section>
  ${visibleFaq}
  ${genericAsoviewCta(`${esc(rn)}の動物園・水族館の電子チケット。当日窓口と同じ料金で、並ばず入園。`)}
  ${otherRegions ? `<section style="margin:1.5rem 0;"><h2 style="font-size:1.1rem;margin:0 0 .6rem;">ほかの地域から探す</h2><nav aria-label="他エリア" style="display:flex;flex-wrap:wrap;">${otherRegions}</nav></section>` : ''}
  <p style="text-align:center;margin:2rem 0;"><a class="dbb-cta" href="/species/">動物の種類から探す →</a></p>
</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

function speciesIndexHtml(babies) {
  const grouped = new Map();
  for (const b of babies) {
    if (!b.species) continue;
    grouped.set(b.species, (grouped.get(b.species) || 0) + 1);
  }
  const entries = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);

  const title = `動物の種類別 赤ちゃん一覧（全${entries.length}種）| どうベビ`;
  const desc = `動物の種類別に赤ちゃんをまとめて紹介。コアラ・キリン・トラ・ペンギンなど${entries.length}種・${babies.length}頭を掲載。気になる動物の赤ちゃんがいる動物園がすぐにわかる。`;
  const canonical = `${SITE_BASE}/species/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '動物種別一覧',
    description: desc,
    url: canonical,
  });

  const cards = entries.map(([sp, n]) => {
    const slug = encodeURI(sp);
    const emoji = pickEmoji(sp);
    return `<a class="species-card" href="/species/${slug}/" style="display:flex;align-items:center;gap:0.75rem;padding:1rem;background:rgba(255,255,255,0.7);border-radius:12px;text-decoration:none;color:inherit;transition:transform .15s;">
      <div style="font-size:2.4rem;">${emoji}</div>
      <div>
        <h3 style="margin:0;font-size:1.05rem;">${esc(sp)}</h3>
        <p style="margin:0.25rem 0 0;font-size:0.85rem;color:#666;">🐣 ${n}頭の赤ちゃん</p>
      </div>
    </a>`;
  }).join('');

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<body class="theme">
${siteHeader()}
${siteNav('/babies/')}
<main class="container" id="main">
  <section class="page-hero">
    <h1 class="page-title">動物の種類別 赤ちゃん一覧</h1>
    <p class="page-subtitle">${entries.length}種・${babies.length}頭の赤ちゃんを掲載中</p>
  </section>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem;margin:1rem 0;">${cards}</div>

  ${genericAsoviewCta()}
</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

// ─── 春の特集ページ ──────────────────────────────────────

function springSpecialHtml(babies, slugMap) {
  // 季節ウィンドウ: 2025-09〜2026-05 生まれ
  const inWindow = (b) => {
    if (!b.birthday) return false;
    const m = b.birthday.match(/^(\d{4})-(\d{2})-/);
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]);
    return (y === 2026 && mo >= 1 && mo <= 5) || (y === 2025 && mo >= 7);
  };
  const hasPhoto = (b) => !!b.thumbnail_url;
  const byNewest = (a, b) => String(b.birthday).localeCompare(String(a.birthday));

  // 写真あり＆誕生日ありに限定（PROP-20260608-01。inWindow が null 誕生日を除外）。
  const springBabies = babies.filter(b => inWindow(b) && hasPhoto(b)).sort(byNewest);

  // 地域グルーピング（/area/ と同一の REGIONS を再利用）
  const prefRegion = {};
  REGIONS.forEach(([rn, prefs]) => prefs.forEach(p => { prefRegion[p] = rn; }));
  const regionMap = new Map();
  for (const b of springBabies) {
    const rn = prefRegion[b.prefecture] || 'その他';
    if (!regionMap.has(rn)) regionMap.set(rn, []);
    regionMap.get(rn).push(b);
  }
  const regionOrder = REGIONS.map(([rn]) => rn).filter(rn => regionMap.has(rn));
  if (regionMap.has('その他')) regionOrder.push('その他');

  // メタを実掲載種に動的整合（ハードコード撤廃）
  const speciesList = [...new Set(springBabies.map(b => b.species).filter(Boolean))];
  const speciesPhrase = speciesList.slice(0, 4).join('・') || '人気の動物';
  const prefSet = new Set(springBabies.map(b => b.prefecture).filter(Boolean));

  const title = '2026年春の動物園赤ちゃんラッシュ — 地域別・会いに行けるベビー特集｜どうベビ';
  const desc = `2026年春、全国の動物園で会える赤ちゃん${springBabies.length}頭を地域別にご紹介。${speciesPhrase}など、いまお近くの動物園で会えるベビーを公開状況つきでまとめました。お出かけ先選びの完全ガイド。`.slice(0, 200);
  const canonical = `${SITE_BASE}/specials/spring-2026/`;

  const sections = regionOrder.map(rn => {
    const list = regionMap.get(rn).sort(byNewest);
    const cards = list.map(b => zooBabyCardHtml(b, slugMap)).join('');
    return `<section style="margin:1.8rem 0;">
      <h2 style="font-size:1.2rem;margin:0 0 1rem;border-bottom:2px solid #d6efe4;padding-bottom:.35rem;">\u{1F4CD} ${esc(rn)}で会える赤ちゃん <span style="font-size:.82rem;color:#888;font-weight:normal;">${list.length}頭</span></h2>
      <div class="baby-grid">${cards}</div>
    </section>`;
  }).join('');

  const faqItems = [
    { q: '動物園の赤ちゃんはいつ見頃ですか？', a: '生後2〜6か月ごろは活発に動き、親子の様子も観察しやすい見頃です。午前中の涼しい時間帯に活動的なことが多いので、開園直後の来園がおすすめです。' },
    { q: '赤ちゃんは毎日会えますか？公開状況の見方は？', a: '各カードに「\u{1F7E2} 公開中（一般公開中）」「\u{1F7E1} 近日公開（一般公開前）」のバッジを表示しています。\u{1F7E2} は通常展示で会えますが、体調・天候・季節で展示時間や場所が変わることがあります。おでかけ前に各動物園の公式サイトやSNSで当日の展示状況をご確認ください。' },
    { q: '予約やチケットは必要ですか？', a: '多くの動物園は当日入園できますが、前売り券を用意しておくと当日スムーズです。混雑期は入場制限がある園もあるため、公式サイトで最新情報を確認してからのお出かけが安心です。' },
    { q: '近くの動物園の赤ちゃんはどう探せますか？', a: 'このページは地域別にまとめています。さらに詳しく探すなら、エリア別ハブから全国の動物園と赤ちゃんを地域でしぼり込めます。' },
  ];
  const faqLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqItems.map(it => ({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })),
  });
  const visibleFaq = `<section style="margin:2rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 1rem;">\u{2753} お出かけ前によくある質問</h2>
    ${faqItems.map(it => `<details style="margin:0 0 .6rem;padding:.8rem 1rem;background:rgba(255,255,255,0.6);border-radius:10px;">
      <summary style="cursor:pointer;font-weight:600;line-height:1.5;">${esc(it.q)}</summary>
      <p style="margin:.6rem 0 0;line-height:1.7;">${esc(it.a)}</p>
    </details>`).join('')}
  </section>`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: '2026年春の動物園赤ちゃんラッシュ — 地域別ガイド',
    description: desc, url: canonical,
    datePublished: '2026-05-21', dateModified: new Date().toISOString().slice(0, 10),
    publisher: { '@type': 'Organization', name: 'どうベビ', url: SITE_BASE },
    mainEntityOfPage: canonical,
  });
  const extraJsonLd = `<script type="application/ld+json">${faqLd}</script>`;
  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${SITE_BASE}/` },
      { '@type': 'ListItem', position: 2, name: '特集', item: `${SITE_BASE}/specials/` },
      { '@type': 'ListItem', position: 3, name: '2026年春の赤ちゃんラッシュ', item: canonical },
    ],
  });

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd, extraJsonLd })}
<script type="application/ld+json">${breadcrumbLd}</script>
<body class="theme">
${siteHeader()}
${siteNav('/')}
<main class="container" id="main">
  <section class="page-hero">
    <h1 class="page-title">\u{1F338} 2026年春の<br>動物園赤ちゃんラッシュ</h1>
    <p class="page-subtitle">全国 ${prefSet.size}都道府県・${springBabies.length}頭の最新ベビーに会いに行こう</p>
  </section>

  <section style="margin:1.5rem 0;padding:1rem;background:rgba(255,255,255,0.6);border-radius:12px;line-height:1.8;">
    <p>春は動物園に新しい命があふれる季節。<strong>${esc(speciesPhrase)}</strong>──いま全国の動物園では、たくさんの赤ちゃんがすくすく育っています。</p>
    <p>このページでは、<strong>2025年夏〜2026年春に誕生</strong>した写真つきの赤ちゃんを<strong>地域別</strong>にご紹介。各カードの<strong>公開状況バッジ</strong>で「いま会えるか」もひと目でわかります。お近くの動物園を見つけて、会いに行く参考にどうぞ。</p>
    <p style="margin-top:.6rem;"><a href="/area/" style="color:#0a7a5c;font-weight:700;text-decoration:none;">\u{1F5FE} 地域・エリアからもっと探す →</a></p>
  </section>

  ${sections || '<p>赤ちゃん情報を準備中です。</p>'}

  ${genericAsoviewCta('お近くの動物園の電子チケット。当日窓口と同じ料金で、並ばず入園。')}

  ${visibleFaq}

  <p style="text-align:center;margin:2rem 0;"><a class="dbb-cta" href="/babies/">全ての赤ちゃんを見る →</a></p>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}


/**
 * 特集ハブ: 絶滅危惧種の赤ちゃん特集（/specials/endangered/）
 * 在籍する絶滅危惧種（IUCN: CR/EN/VU/NT）の赤ちゃんを保全ランク順に紹介する
 * オリジナルのまとめ記事。各 baby 個別ページへ内部リンクを集約して回遊と被リンクを促す。
 */
function endangeredSpecialHtml(babies, slugMap) {
  const rankWeight = (iucn) => {
    if (!iucn) return 0;
    if (iucn.includes('CR')) return 4;
    if (iucn.includes('EN')) return 3;
    if (iucn.includes('VU')) return 2;
    if (iucn.includes('NT')) return 1;
    return 0;
  };

  const targets = babies
    .filter(b => b.species && SPECIES_INFO[b.species] && rankWeight(SPECIES_INFO[b.species].iucn) > 0)
    .sort((a, b) => {
      const w = rankWeight(SPECIES_INFO[b.species].iucn) - rankWeight(SPECIES_INFO[a.species].iucn);
      if (w !== 0) return w;
      return String(b.birthday).localeCompare(String(a.birthday));
    });

  const speciesSet = new Set(targets.map(b => b.species));
  const title = `絶滅危惧種の赤ちゃん特集｜日本の動物園で会える希少な命${targets.length}頭 | どうベビ`;
  const desc = `日本の動物園で生まれた絶滅危惧種の赤ちゃんを特集。コビトカバ・ニシゴリラ・スマトラトラなど${speciesSet.size}種・${targets.length}頭の希少な赤ちゃんをIUCN保全ランク順にご紹介。動物園での繁殖がなぜ大切なのかもわかる完全ガイド。`.slice(0, 200);
  const canonical = `${SITE_BASE}/specials/endangered/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: '絶滅危惧種の赤ちゃん特集 — 日本の動物園で会える希少な命',
    description: desc,
    url: canonical,
    datePublished: '2026-05-29',
    dateModified: new Date().toISOString().slice(0, 10),
    author: { '@type': 'Organization', name: 'どうベビ編集部', url: SITE_BASE },
    publisher: { '@type': 'Organization', name: 'どうベビ', url: SITE_BASE },
    mainEntityOfPage: canonical,
  });

  const cards = targets.map(b => zooBabyCardHtml(b, slugMap)).join('');

  const byRank = { CR: [], EN: [], VU: [], NT: [] };
  for (const b of targets) {
    const iucn = SPECIES_INFO[b.species].iucn || '';
    if (iucn.includes('CR')) byRank.CR.push(b);
    else if (iucn.includes('EN')) byRank.EN.push(b);
    else if (iucn.includes('VU')) byRank.VU.push(b);
    else if (iucn.includes('NT')) byRank.NT.push(b);
  }
  const rankSections = [
    ['CR', 'CR｜近絶滅種', 'いますぐ絶滅の危機に瀕している、最も保全の優先度が高いランク。'],
    ['EN', 'EN｜絶滅危惧種', '野生での絶滅の危険性が高いランク。動物園での繁殖が種の存続に直結します。'],
    ['VU', 'VU｜危急種', '将来的に絶滅が心配されるランク。今のうちの保全活動が重要です。'],
    ['NT', 'NT｜準絶滅危惧', '現時点では危機的でないものの、注意が必要なランク。'],
  ].map(([key, label, note]) => {
    if (byRank[key].length === 0) return '';
    return `
  <section style="margin:2rem 0;">
    <h2 style="font-size:1.2rem;margin:0 0 .5rem;">${label}（${byRank[key].length}頭）</h2>
    <p style="opacity:.85;margin:0 0 1rem;line-height:1.7;">${note}</p>
    <div class="baby-grid">${byRank[key].map(b => zooBabyCardHtml(b, slugMap)).join('')}</div>
  </section>`;
  }).join('');

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<body class="theme">
${siteHeader()}
${siteNav('/')}
<main class="container" id="main">

  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <a href="/specials/">特集</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">絶滅危惧種の赤ちゃん</span>
  </nav>

  <section class="page-hero">
    <h1 class="page-title">🌍 絶滅危惧種の<br>赤ちゃん特集</h1>
    <p class="page-subtitle">日本の動物園で会える希少な命 ${targets.length}頭・${speciesSet.size}種</p>
  </section>

  <section style="margin:1.5rem 0;padding:1rem;background:rgba(255,255,255,0.6);border-radius:12px;line-height:1.9;">
    <p>世界では今、多くの動物が絶滅の危機に瀕しています。国際自然保護連合（IUCN）が作成する<strong>レッドリスト</strong>では、危機の度合いに応じて生き物がランク分けされています。</p>
    <p>動物園で生まれる希少種の赤ちゃん一頭一頭は、その種の未来をつなぐ、かけがえのない存在です。このページでは、<strong>日本の動物園で暮らす絶滅危惧種の赤ちゃん</strong>を、保全の優先度が高い順にご紹介します。会いに行くことが、その動物たちを知り、守る第一歩になります。</p>
  </section>

  ${rankSections || `<div class="baby-grid">${cards}</div>`}

  <section style="margin:2rem 0;padding:1rem;background:rgba(255,255,255,0.5);border-radius:12px;line-height:1.8;">
    <h2 style="font-size:1.1rem;margin:0 0 .5rem;">動物園での繁殖が大切な理由</h2>
    <p>生息地の開発や気候変動により、野生動物の数は世界的に減り続けています。動物園は単に動物を「見せる」場所ではなく、希少種を計画的に繁殖させ、研究し、いつか野生に還す可能性をつなぐ「箱舟」としての役割を担っています。赤ちゃんの誕生は、その地道な取り組みが実を結んだ瞬間なのです。</p>
  </section>

  <p style="text-align:center;margin:2rem 0;"><a class="dbb-cta" href="/babies/">全ての赤ちゃんを見る →</a></p>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

/**
 * 特集ハブ一覧（/specials/）— 各特集記事への入口。クロール経路と回遊を強化。
 */
function specialsIndexHtml(babies) {
  const title = '特集・まとめ記事｜どうベビ';
  const desc = '日本の動物園で生まれた赤ちゃん動物の特集・まとめ記事一覧。絶滅危惧種の赤ちゃん特集、季節ごとのベビーラッシュ特集など、テーマ別に動物園の赤ちゃんを紹介します。';
  const canonical = `${SITE_BASE}/specials/`;

  const endangeredCount = babies.filter(b => b.species && SPECIES_INFO[b.species] && /CR|EN|VU|NT/.test(SPECIES_INFO[b.species].iucn || '')).length;
  const springCount = babies.filter(b => {
    if (!b.birthday) return false;
    const m = b.birthday.match(/^(\d{4})-(\d{2})-/);
    if (!m) return false;
    const y = Number(m[1]); const mo = Number(m[2]);
    return (y === 2026 && mo >= 1 && mo <= 5) || (y === 2025 && mo >= 7);
  }).length;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: desc,
    url: canonical,
    publisher: { '@type': 'Organization', name: 'どうベビ', url: SITE_BASE },
  });

  const features = [
    {
      href: '/specials/endangered/',
      emoji: '🌍',
      heading: '絶滅危惧種の赤ちゃん特集',
      text: `日本の動物園で会える希少種の赤ちゃん${endangeredCount}頭を、IUCN保全ランク順にご紹介。`,
    },
    {
      href: '/specials/spring-2026/',
      emoji: '🌸',
      heading: '2026年春の動物園赤ちゃんラッシュ',
      text: `2025年秋〜2026年春に生まれた最新ベビー${springCount}頭をピックアップ。`,
    },
  ];

  const cards = features.map(f => `
    <a class="card" href="${f.href}" style="display:block;padding:1.25rem;text-decoration:none;color:inherit;">
      <div style="font-size:2rem;">${f.emoji}</div>
      <h2 style="font-size:1.15rem;margin:.5rem 0;">${esc(f.heading)}</h2>
      <p style="opacity:.85;line-height:1.7;margin:0;">${esc(f.text)}</p>
    </a>`).join('');

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<body class="theme">
${siteHeader()}
${siteNav('/')}
<main class="container" id="main">

  <nav class="ssg-breadcrumb" aria-label="パンくず">
    <a href="/">ホーム</a>
    <span aria-hidden="true"> › </span>
    <span aria-current="page">特集</span>
  </nav>

  <section class="page-hero">
    <h1 class="page-title">📚 特集・まとめ記事</h1>
    <p class="page-subtitle">テーマ別に動物園の赤ちゃんを深掘り</p>
  </section>

  <div class="baby-grid" style="margin:1.5rem 0;">${cards}</div>

  ${genericAsoviewCta()}

  <p style="text-align:center;margin:2rem 0;"><a class="dbb-cta" href="/babies/">全ての赤ちゃんを見る →</a></p>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}


// ─── HTMLサイトマップページ（人間用 + Googleクロール経路拡大） ──────

function buildSitemapHtml(babies, newsItems, slugMap) {
  const title = 'サイトマップ｜どうベビ';
  const desc = `どうベビの全ページ一覧。${babies.length}頭の赤ちゃん・${ZOOS.length}園の動物園・特集ページなど全${babies.length + ZOOS.length + 30}ページへすぐアクセスできます。`;
  const canonical = `${SITE_BASE}/sitemap/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'サイトマップ',
    description: desc,
    url: canonical,
  });

  // 主要ページ
  const mainPages = `
    <ul>
      <li><a href="/">ホーム</a></li>
      <li><a href="/babies/">赤ちゃん一覧（全${babies.length}頭）</a></li>
      <li><a href="/zoos/">動物園一覧（都道府県別）</a></li>
      <li><a href="/species/">動物種別一覧</a></li>
      <li><a href="/specials/">📚 特集・まとめ記事一覧</a></li>
      <li><a href="/specials/endangered/">🌍 絶滅危惧種の赤ちゃん特集</a></li>
      <li><a href="/specials/spring-2026/">🌸 2026年春の赤ちゃんラッシュ特集</a></li>
      <li><a href="/news/">ニュース一覧</a></li>
      <li><a href="/calendar/">誕生日カレンダー</a></li>
      <li><a href="/area/">エリア（地域）から探す</a></li>
    </ul>`;

  // 動物園一覧
  const zooLinks = ZOOS.map(z => `<li><a href="/zoos/${esc(z.slug)}/">${esc(z.name)}<small style="color:#888;"> （${esc(z.prefecture)}）</small></a></li>`).join('');

  // 種別一覧
  const speciesSet = new Set(babies.map(b => b.species).filter(Boolean));
  const speciesLinks = Array.from(speciesSet).sort().map(sp => `<li><a href="/species/${encodeURI(sp)}/">${esc(sp)}の赤ちゃん</a></li>`).join('');

  // 赤ちゃん個別ページ（最新順）
  const babyLinks = babies.slice(0, 100).map(b => {
    const slug = slugMap?.get(b.id) || b.id;
    const label = b.name ? `${esc(b.name)}（${esc(b.species || '?')}）` : esc(b.species || '名前未判明');
    return `<li><a href="/babies/${slug}/">${label}<small style="color:#888;"> @ ${esc(b.zoo_name || '?')}</small></a></li>`;
  }).join('');

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, canonical, jsonLd })}
<body class="theme">
${siteHeader()}
${siteNav('/')}
<main class="container" id="main">
  <section class="page-hero">
    <h1 class="page-title">サイトマップ</h1>
    <p class="page-subtitle">全${babies.length}頭・${ZOOS.length}園・${speciesSet.size}種を網羅</p>
  </section>

  <section style="margin:1.5rem 0;">
    <h2 style="font-size:1.1rem;margin:0 0 .5rem;">📄 主要ページ</h2>
    ${mainPages}
  </section>

  <section style="margin:1.5rem 0;">
    <h2 style="font-size:1.1rem;margin:0 0 .5rem;">🏛️ 動物園（${ZOOS.length}園）</h2>
    <ul style="columns:2;column-gap:1rem;">${zooLinks}</ul>
  </section>

  <section style="margin:1.5rem 0;">
    <h2 style="font-size:1.1rem;margin:0 0 .5rem;">🐾 動物種別（${speciesSet.size}種）</h2>
    <ul style="columns:2;column-gap:1rem;">${speciesLinks}</ul>
  </section>

  <section style="margin:1.5rem 0;">
    <h2 style="font-size:1.1rem;margin:0 0 .5rem;">🐣 赤ちゃん（${babies.length}頭）</h2>
    <ul style="columns:2;column-gap:1rem;">${babyLinks}</ul>
  </section>

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

function buildSitemap(babies, newsItems, slugMap) {
  const today = new Date().toISOString().slice(0, 10);

  const staticUrls = [
    { loc: `${SITE_BASE}/`,                          priority: '1.0', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/babies/`,                   priority: '0.9', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/news/`,                     priority: '0.9', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/zoos/`,                     priority: '0.9', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/calendar/`,                 priority: '0.8', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/sitemap/`,                  priority: '0.8', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/species/`,                  priority: '0.8', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/area/`,                     priority: '0.8', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/specials/spring-2026/`,     priority: '0.8', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/specials/`,                 priority: '0.8', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/specials/endangered/`,      priority: '0.8', changefreq: 'weekly',  lastmod: today },
  ];

  const speciesSet = new Set(babies.map(b => b.species).filter(Boolean));
  const speciesUrls = Array.from(speciesSet).map(sp => ({
    // 生の日本語URL（sitemap側の encodeURI() が一度だけエンコードする）
    loc:        `${SITE_BASE}/species/${sp}/`,
    priority:   '0.7',
    changefreq: 'weekly',
    lastmod:    today,
  }));

  const zooUrls = ZOOS.map(z => ({
    loc:        `${SITE_BASE}/zoos/${z.slug}/`,
    priority:   '0.8',
    changefreq: 'weekly',
    lastmod:    today,
  }));

  const babyUrls = babies.map(b => ({
    loc:        `${SITE_BASE}/babies/${slugMap?.get(b.id) || b.id}/`,
    priority:   '0.7',
    changefreq: 'monthly',
    lastmod:    b.birthday ? b.birthday.slice(0, 10) : today,
  }));

  const newsUrls = newsItems.map(n => ({
    loc:        `${SITE_BASE}/news/${n.id}/`,
    priority:   '0.5',
    changefreq: 'yearly',
    lastmod:    n.published_at ? n.published_at.slice(0, 10) : today,
  }));

  const areaUrls = areaRegionData(babies).order.map(rn => ({
    loc: `${SITE_BASE}/area/${rn}/`, priority: '0.8', changefreq: 'weekly', lastmod: today,
  }));

  const allUrls = [...staticUrls, ...zooUrls, ...speciesUrls, ...areaUrls, ...babyUrls]; // news個別はnoindexのためサイトマップ除外
  const entries = allUrls.map(u => `  <url>
    <loc>${encodeURI(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

// ─── 静的ページ差分注入ヘルパー ────────────────────────────────────────

/** SSGマーカー間のコンテンツを置換する */
function patchSection(html, sectionName, newContent) {
  const re = new RegExp(`<!--SSG:${sectionName}:start-->[\\s\\S]*?<!--SSG:${sectionName}:end-->`, 'g');
  return html.replace(re, `<!--SSG:${sectionName}:start-->${newContent}<!--SSG:${sectionName}:end-->`);
}

/** 種別からemoji */
function pickEmoji(species) {
  const s = String(species || '').toLowerCase();
  const MAP = [
    ['🦊', ['レッサーパンダ', 'lesser panda', 'red panda']],
    ['🐼', ['パンダ', 'panda']],
    ['🐻‍❄️', ['ホッキョクグマ', 'polar bear', 'polar']],
    ['🐻', ['ヒグマ', 'ツキノワグマ', 'bear']],
    ['🐯', ['ホワイトタイガー', 'white tiger', 'アムールトラ', 'スマトラトラ', 'トラ', 'tiger']],
    ['🦁', ['ライオン', 'lion']],
    ['🐘', ['ゾウ', 'elephant']],
    ['🦒', ['キリン', 'giraffe', 'オカピ', 'okapi']],
    ['🦛', ['カバ', 'hippo']],
    ['🦏', ['サイ', 'rhino']],
    ['🐨', ['コアラ', 'koala']],
    ['🦦', ['カワウソ', 'otter']],
    ['🐧', ['ペンギン', 'penguin']],
    ['🦍', ['ゴリラ', 'gorilla']],
    ['🦧', ['オランウータン', 'orangutan']],
    ['🐒', ['サル', 'monkey', 'ニホンザル', 'テングザル', 'ミーアキャット']],
    ['🦫', ['ビーバー', 'beaver']],
    ['🦨', ['コアリクイ', 'anteater']],
    ['🐆', ['ヒョウ', 'leopard', 'ジャガー', 'jaguar']],
    ['🦁', ['ライオン', 'lion']],
    ['🦓', ['シマウマ', 'zebra']],
    ['🦌', ['シカ', 'deer', 'エランド', 'eland']],
    ['🦩', ['フラミンゴ', 'flamingo']],
    ['🦭', ['アシカ', 'アザラシ', 'seal', 'sea lion']],
  ];
  for (const [emoji, keys] of MAP) {
    if (keys.some(k => s.includes(k.toLowerCase()))) return emoji;
  }
  return '🐾';
}

/** 経過時間ラベル */
function agoLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays < 1)  return '今日';
  if (diffDays < 7)  return `${diffDays}日前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}ヶ月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

/** ニュースカテゴリ判定 */
function categorizeNews(title) {
  const t = String(title || '');
  if (/(誕生|生まれ|赤ちゃん|出産|公開デビュー)/.test(t)) return { tag: '誕生',    icon: '🐾', bg: 'var(--news-tag-birth-bg)', color: 'var(--ac)' };
  if (/(死去|逝去|亡くなり|訃報|死亡)/.test(t))           return { tag: '訃報',    icon: '💐', bg: 'var(--news-tag-death-bg)', color: 'var(--news-tag-death-text)' };
  if (/(イベント|祭り|ナイト|ふれあい|GW|夏休み|開催)/.test(t)) return { tag: 'イベント', icon: '🎉', bg: 'var(--news-tag-event-bg)', color: '#E8963A' };
  return { tag: 'お知らせ', icon: '🏛️', bg: 'var(--news-tag-info-bg)', color: '#5B8AC4' };
}

/** MM/DD 形式 */
function fmtMD(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * index.html の #recent-list と #news-preview-list を静的コンテンツで埋める
 */
/** ヒーロー「お誕生日の赤ちゃん」を当月（無ければ最大5ヶ月遡る）で静的生成。
 *  app.js のクライアント描画と同じ .dbb-bc カード／同じ絞り込み（誕生月一致・年齢0〜3）に揃える。
 *  JS有効時は app.js が #hero-list を上書きするため、これはクローラー／JS無効向けの初期表示。 */
function heroBirthdayHtml(babies, slugMap) {
  const fmtMD = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const ageOn = (iso, ref) => {
    const b = new Date(iso); if (isNaN(b)) return null;
    let a = ref.getFullYear() - b.getFullYear();
    const m = ref.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) a--;
    return a;
  };
  const monthFiltered = (ref) => {
    const mm = ref.getMonth(), yyyy = ref.getFullYear();
    return babies.filter(b => {
      if (!b.birthday) return false;
      const bd = new Date(b.birthday); if (isNaN(bd)) return false;
      if (bd.getMonth() !== mm) return false;
      if (bd.getFullYear() > yyyy) return false;
      const a = ageOn(b.birthday, ref);
      return a != null && a >= 0 && a <= 3;
    });
  };
  const now = new Date();
  let ref = new Date(now.getFullYear(), now.getMonth(), 1);
  let list = [], monthsBack = 0;
  for (let i = 0; i <= 5; i++) {
    const r = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const f = monthFiltered(r);
    if (f.length) { ref = r; list = f; monthsBack = i; break; }
  }
  const label = monthsBack === 0
    ? '0〜3歳 · 今月生まれ'
    : `0〜3歳 · ${ref.getFullYear()}年${ref.getMonth() + 1}月生まれ`;
  if (!list.length) {
    return { html: `\n<div class="empty-state"><p class="empty-state__desc">今月お誕生日の赤ちゃんはおやすみ中です。<a href="/babies/">最近生まれた赤ちゃんを見る ›</a></p></div>\n`, label: '0〜3歳 · 今月生まれ' };
  }
  list = [...list].sort((a, b) => a.birthday.localeCompare(b.birthday));
  const cards = list.map(b => {
    const name = esc(b.name || '（名前未設定）');
    const sp   = esc(b.species || '不明');
    const zoo  = esc(b.zoo_name || '園情報なし');
    const slug = slugMap?.get(b.id) || b.id;
    const href = `/babies/${slug}/`;
    const a    = ageOn(b.birthday, ref);
    const date = fmtMD(b.birthday);
    const thumb = b.thumbnail_url
      ? `<img src="${esc(b.thumbnail_url)}" alt="${name}" loading="lazy" decoding="async">`
      : '';
    const thumbCls = b.thumbnail_url ? 'dbb-bc__img' : 'dbb-bc__img is-placeholder';
    return `<a class="dbb-bc" role="listitem" href="${href}" aria-label="${name}（${sp}）">
  <div class="${thumbCls}">${thumb}${a != null ? `<div class="dbb-bc__age">${a}歳</div>` : ''}</div>
  <div class="dbb-bc__body">
    <div class="dbb-bc__name">${name}</div>
    <div class="dbb-bc__species">${sp}</div>
    <div class="dbb-bc__zoo">📍 ${zoo}</div>
    <div class="dbb-bc__bday">🎂 ${date}</div>
  </div>
</a>`;
  }).join('\n');
  return { html: `\n${cards}\n`, label };
}

function patchIndexHtml(babies, newsItems, slugMap) {
  const indexPath = path.join(WEB_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) return;
  let html = fs.readFileSync(indexPath, 'utf-8');

  // 新着の赤ちゃん（誕生日降順 上位6件）
  const recentBabies = [...babies]
    .filter(b => b.birthday)
    .sort((a, b) => b.birthday.localeCompare(a.birthday))
    .slice(0, 6);

  const recentHtml = recentBabies.map(b => {
    const name    = esc(b.name || '（名前未設定）');
    const species = esc(b.species || '不明');
    const zoo     = esc(b.zoo_name || '');
    const slug    = slugMap?.get(b.id) || b.id;
    const href    = `/babies/${slug}/`;
    const emoji   = pickEmoji(b.species);
    const thumb   = b.thumbnail_url
      ? `<img src="${esc(b.thumbnail_url)}" alt="${name}" loading="lazy" decoding="async">`
      : emoji;
    const ago     = agoLabel(b.birthday);
    return `<a class="dbb-brow" href="${href}" role="listitem">
  <div class="dbb-brow__thumb">${thumb}</div>
  <div class="dbb-brow__info">
    <div class="dbb-brow__name">${name}</div>
    <div class="dbb-brow__species">${species}</div>
    ${zoo ? `<div class="dbb-brow__zoo">📍 ${zoo}</div>` : ''}
  </div>
  ${ago ? `<div class="dbb-brow__badge">${ago}</div>` : ''}
</a>`;
  }).join('\n');

  // 最新ニュース（上位3件）
  const recentNews = newsItems.slice(0, 3);
  const newsHtml = recentNews.map(item => {
    const cat   = categorizeNews(item.title);
    const title = esc(item.title || '(無題)');
    const href  = esc(item.url || '#');
    const date  = fmtDate(item.published_at);
    const src   = item.source_name ? ` · ${esc(item.source_name)}` : '';
    return `<a class="dbb-nitem" href="${href}" target="_blank" rel="noopener" role="listitem">
  <div class="dbb-nitem__icon" style="background:${cat.bg}">${cat.icon}</div>
  <div class="dbb-nitem__body">
    <div class="dbb-nitem__tag" style="color:${cat.color}">${cat.tag}</div>
    <p class="dbb-nitem__title">${title}</p>
    <div class="dbb-nitem__date">${date}${src}</div>
  </div>
</a>`;
  }).join('\n');

  // 種ハブ（在籍頭数の多い順 上位16種）
  const speciesCount = {};
  babies.forEach(b => { if (b.species) speciesCount[b.species] = (speciesCount[b.species] || 0) + 1; });
  const topSpecies = Object.entries(speciesCount).sort((a, b) => b[1] - a[1]).slice(0, 16);
  const speciesHubHtml = topSpecies.map(([sp, n]) =>
    `<a href="/species/${encodeURI(sp)}/" style="display:inline-block;padding:.4rem .9rem;margin:.25rem;background:#f0f7f4;border-radius:999px;color:#0a7a5c;text-decoration:none;font-size:.95rem;">${esc(sp)} <span style="opacity:.55;font-size:.85em;">${n}</span></a>`
  ).join('\n');

  // 構造化データ（WebSite / Organization / ItemList）
  const indexJsonLd = JSON.stringify([
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'どうベビ', alternateName: '動物の赤ちゃん図鑑 どうベビ', url: SITE_BASE, inLanguage: 'ja', description: '全国の動物園・水族館で生まれた赤ちゃんの最新情報をまとめて紹介するサイト。' },
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'どうベビ', url: SITE_BASE, logo: `${SITE_BASE}/assets/img/og.png` },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: '新着の赤ちゃん', itemListElement: recentBabies.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_BASE}/babies/${slugMap?.get(b.id) || b.id}/`, name: `${b.name || ''}（${b.species || ''}）` })) },
  ]);

  const __hero = heroBirthdayHtml(babies, slugMap);
  html = patchSection(html, 'hero', __hero.html);
  html = patchSection(html, 'heromonth', __hero.label);
  html = patchSection(html, 'recent', `\n${recentHtml}\n`);
  html = patchSection(html, 'news', `\n${newsHtml}\n`);
  html = patchSection(html, 'specieshub', `\n${speciesHubHtml}\n`);
  html = patchSection(html, 'jsonld', `\n<script type="application/ld+json">${indexJsonLd}</script>\n`);
  fs.writeFileSync(indexPath, html, 'utf-8');
}

/**
 * calendar/index.html をビルド時の月で静的コンテンツに差し替える
 */
function patchCalendarHtml(babies, slugMap) {
  const calPath = path.join(WEB_DIR, 'calendar', 'index.html');
  if (!fs.existsSync(calPath)) return;
  let html = fs.readFileSync(calPath, 'utf-8');

  const now   = new Date();
  const Y     = now.getFullYear();
  const M     = now.getMonth() + 1; // 1-12

  // 当月に誕生日がある 0〜3歳の赤ちゃんを抽出
  const monthBabies = babies.filter(b => {
    if (!b.birthday) return false;
    const bd  = new Date(b.birthday);
    const age = Y - bd.getFullYear();
    return bd.getMonth() + 1 === M && age >= 0 && age <= 3;
  }).sort((a, b) => new Date(a.birthday).getDate() - new Date(b.birthday).getDate());

  // --- カレンダーグリッド生成 ---
  const first    = new Date(Y, M - 1, 1);
  const startIdx = first.getDay(); // 0=日
  const lastDate = new Date(Y, M, 0).getDate();
  const prevLast = new Date(Y, M - 1, 0).getDate();
  const todayD   = now.getDate();
  const todayM   = now.getMonth() + 1;
  const todayY   = now.getFullYear();

  let cells = '';

  // 前月末尾
  for (let i = startIdx - 1; i >= 0; i--) {
    cells += `<div class="cal-day other-month" aria-hidden="true"><span class="cal-dn">${prevLast - i}</span><div class="cal-dots"></div></div>`;
  }

  // 当月
  for (let day = 1; day <= lastDate; day++) {
    const dow   = new Date(Y, M - 1, day).getDay();
    const isToday = (day === todayD && M === todayM && Y === todayY);
    const hits  = monthBabies.filter(b => new Date(b.birthday).getDate() === day);
    let cls = 'cal-day';
    if (dow === 0) cls += ' sun';
    if (dow === 6) cls += ' sat';
    if (isToday)  cls += ' today';
    const dots = hits.slice(0, 3).map(() => '<span class="cal-dot cal-dot--birth"></span>').join('');
    const ariaLabel = hits.length
      ? `${Y}年${M}月${day}日、${hits.length}件の誕生日`
      : `${Y}年${M}月${day}日`;
    cells += `<div class="${cls}" role="gridcell" aria-label="${ariaLabel}"><span class="cal-dn">${day}</span><div class="cal-dots">${dots}</div></div>`;
  }

  // 翌月頭
  const trailing = (7 - ((startIdx + lastDate) % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    cells += `<div class="cal-day other-month" aria-hidden="true"><span class="cal-dn">${i}</span><div class="cal-dots"></div></div>`;
  }

  // --- 誕生日リスト生成 ---
  const listHtml = monthBabies.length === 0
    ? '<p class="empty-state__desc">今月は対象がいません。</p>'
    : monthBabies.map(b => {
        const name    = esc(b.name || '（名前未設定）');
        const species = esc(b.species || '');
        const zoo     = esc(b.zoo_name || '');
        const slug    = slugMap?.get(b.id) || b.id;
        const href    = `/babies/${slug}/`;
        const age     = Y - new Date(b.birthday).getFullYear();
        const thumbCls = b.thumbnail_url ? 'dbb-bc__img' : 'dbb-bc__img is-placeholder';
        const thumb   = b.thumbnail_url
          ? `<img src="${esc(b.thumbnail_url)}" alt="${name}" loading="lazy" decoding="async">`
          : '';
        const bday    = fmtMD(b.birthday);
        return `<a class="dbb-bc" role="listitem" href="${href}" aria-label="${name}（${species}）">
  <div class="${thumbCls}">${thumb}<div class="dbb-bc__age">${age}歳</div></div>
  <div class="dbb-bc__body">
    <div class="dbb-bc__name">${name}</div>
    <div class="dbb-bc__species">${species}</div>
    ${zoo ? `<div class="dbb-bc__zoo">📍 ${zoo}</div>` : ''}
    <div class="dbb-bc__bday">🎂 ${bday}</div>
  </div>
</a>`;
      }).join('\n');

  const monthLabel = `${Y}年${M}月`;
  html = patchSection(html, 'cal-title',       monthLabel);
  html = patchSection(html, 'cal-grid',        cells);
  html = patchSection(html, 'cal-month-label', monthLabel);
  html = patchSection(html, 'cal-list',        `\n${listHtml}\n`);
  fs.writeFileSync(calPath, html, 'utf-8');
}

/**
 * _redirects の UUID→slug 301セクションを更新する
 */
function updateRedirects(slugMap) {
  const redirectsPath = path.join(WEB_DIR, '_redirects');
  if (!fs.existsSync(redirectsPath)) return;
  let content = fs.readFileSync(redirectsPath, 'utf-8');

  const lines = [];
  for (const [id, slug] of slugMap.entries()) {
    lines.push(`/babies/${id}/ /babies/${slug}/ 301`);
  }
  const section = `# --- SSG:UUID-redirects:start ---\n${lines.join('\n')}\n# --- SSG:UUID-redirects:end ---`;

  const re = /# --- SSG:UUID-redirects:start ---[\s\S]*?# --- SSG:UUID-redirects:end ---/;
  if (re.test(content)) {
    content = content.replace(re, section);
  } else {
    // マーカーがなければ先頭近くに挿入
    content = content.replace('/sitemap.xml  /sitemap.xml  200\n', `/sitemap.xml  /sitemap.xml  200\n\n${section}\n`);
  }
  fs.writeFileSync(redirectsPath, content, 'utf-8');
}

// ─── データ取得（Supabase または モックファイル） ────────────────────

const USE_MOCK = process.argv.includes('--mock');

// 公開状況(display_status)を babies テーブルから取得し id でマージ。失敗時は全件 public。
async function mergeDisplayStatus(list) {
  if (USE_MOCK) { list.forEach(b => { if (!b.display_status) b.display_status = 'public'; }); return; }
  try {
    const rows = await sbFetch('/rest/v1/babies?select=id,display_status&limit=1000');
    const m = new Map(rows.map(r => [r.id, r.display_status || 'public']));
    list.forEach(b => { b.display_status = m.get(b.id) || 'public'; });
  } catch (e) {
    console.warn(`   \u26A0\uFE0F  display_status \u53D6\u5F97\u5931\u6557 \u2014 \u5168\u4EF6 public \u6271\u3044 (${e.message})`);
    list.forEach(b => { b.display_status = 'public'; });
  }
}

async function fetchBabies() {
  if (USE_MOCK) {
    // モック: 赤ちゃんサンプルデータ（--mock フラグ時）
    return [
      { id: 'demo-baby-001', name: 'レオ',   species: 'ライオン',    birthday: '2024-03-15', zoo_name: 'サンプル動物園', prefecture: '東京都', thumbnail_url: null },
      { id: 'demo-baby-002', name: 'パンちゃん', species: 'ジャイアントパンダ', birthday: '2023-09-01', zoo_name: 'サンプル動物園', thumbnail_url: null },
      { id: 'demo-baby-003', name: 'ぺんた', species: 'ペンギン',    birthday: '2025-01-10', zoo_name: 'デモ水族館', prefecture: '大阪府',    thumbnail_url: null },
    ];
  }
  try {
    const data = await sbFetch('/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo_name,prefecture&order=birthday.desc.nullslast&limit=500');
    await mergeDisplayStatus(data);
    console.log(`   ✅ 赤ちゃん: ${data.length} 件`);
    return data;
  } catch (e) {
    console.warn(`   ⚠️  babies_public 失敗 — babies テーブルで再試行 (${e.message})`);
    const raw = await sbFetch('/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,display_status,zoo_id,zoo:zoos(name,prefecture)&order=birthday.desc.nullslast&limit=500');
    const data = raw.map(x => ({ ...x, zoo_name: x.zoo?.name || '', prefecture: x.zoo?.prefecture || '', display_status: x.display_status || 'public' }));
    console.log(`   ✅ 赤ちゃん（フォールバック）: ${data.length} 件`);
    return data;
  }
}

async function fetchNews() {
  if (USE_MOCK) {
    // モック: 既存 mock JSON を読み込み（id を付与）
    const mockPath = path.join(WEB_DIR, 'assets', 'mock', 'news.json');
    const raw = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));
    return raw.map((x, i) => ({ id: `demo-news-${String(i + 1).padStart(3, '0')}`, ...x }));
  }
  const data = await sbFetch('/rest/v1/news_feed_v2?select=id,title,url,published_at,source_name,source_url,thumbnail_url,kind,featured&order=published_at.desc,id.desc&limit=200');
  console.log(`   ✅ ニュース: ${data.length} 件`);
  return data;
}


// ─── baby 個別ニュース取得 ─────────────────────────────────────────────
// 動物・赤ちゃん関連のキーワード（タイトル品質フィルタ用）
// 動物・園関連キーワード（タイトル品質フィルタ）
const ANIMAL_CONTEXT_KEYWORDS = [
  '動物園','水族館','サファリ','こども動物','動物公園','動物公苑','どうぶつ',
  '動物の','動物が','動物に','動物を','動物達','動物たち',
  '飼育','展示','繁殖','種の保存','保全','飼育員','獣医','園内',
  '動物園で','動物園が','動物園の','水族館で','水族館の',
];
const BABY_CONTEXT_KEYWORDS = [
  '赤ちゃん','ベビー','誕生','生まれ','産まれ','お披露目','披露','命名','名づけ',
  '双子','三つ子','親子','母子',
];
const ANIMAL_NEWS_KEYWORDS = [...ANIMAL_CONTEXT_KEYWORDS, ...BABY_CONTEXT_KEYWORDS];
// 注: '子ども/子供/こども/子/育/初/名前/歳/カ月/ヶ月/か月/頭/匹/羽/成長' は人間の話題と誤マッチしやすいので除外
function isAnimalNewsTitle(title, baby) {
  if (!title) return false;
  // (1) 種名が含まれる場合は通過（「ゾウ」「パンダ」など）
  if (baby && baby.species && title.includes(baby.species)) return true;
  // (2) この baby の動物園名がタイトルに含まれる場合は通過（「日本モンキーセンター」など）
  if (baby && baby.zoo_name && title.includes(baby.zoo_name)) return true;
  // (3) 動物文脈キーワード（動物園/水族館/サファリ/飼育/繁殖など）が含まれる
  return ANIMAL_CONTEXT_KEYWORDS.some(k => title.includes(k));
}
function isNameStrongMatch(title, baby) {
  if (!title || !baby || !baby.name) return false;
  const name = baby.name.trim();
  if (name.length < 2) return false;
  if (!title.includes(name)) return false;
  // 厳格な strong match:「名前」+「種名 OR 動物園名」両方含むこと
  // 種名: 「Coqu」+「ゾウ」のように名前と種が一緒に出てくる場合
  // 動物園名: 「ふく」+「野毛山動物園」のように所属が明示されている場合
  const hasSpecies = baby.species && title.includes(baby.species);
  const hasZoo     = baby.zoo_name && title.includes(baby.zoo_name);
  return hasSpecies || hasZoo;
}

// baby に紐づくニュースを zoo_id 経由で取得（fallback: sources経由）
// zoo_name → zoo_ids[] のキャッシュ（同名zoo複数登録への対処）
const ZOO_IDS_BY_NAME_CACHE = new Map();
async function resolveAllZooIds(baby) {
  const ids = new Set();
  if (baby && baby.zoo_id) ids.add(baby.zoo_id);
  if (!baby || !baby.zoo_name || USE_MOCK) return Array.from(ids);
  const key = baby.zoo_name.trim();
  if (!key) return Array.from(ids);
  const cached = ZOO_IDS_BY_NAME_CACHE.get(key);
  if (cached) { cached.forEach(i => ids.add(i)); return Array.from(ids); }
  try {
    // (1) 完全一致
    const exact = await sbFetch(`/rest/v1/zoos?select=id,name&name=eq.${encodeURIComponent(key)}`);
    (exact||[]).forEach(z => ids.add(z.id));
    // (2) 「baby.zoo_name を全体として」末尾に含む長い zoos.name のみ追加（特定的）
    // 例: baby.zoo_name='ズーラシア' → 'よこはま動物園ズーラシア' を取り込みOK
    //     baby.zoo_name='上野動物園' → '恩賜上野動物園' を取り込みOK
    // ただしキーが3文字以下なら誤マッチ多発するので拡張しない
    if (key.length >= 4) {
      const long = await sbFetch(`/rest/v1/zoos?select=id,name&name=ilike.*${encodeURIComponent(key)}&limit=5`);
      (long||[]).forEach(z => {
        // 念のため、検索hitした name が key を本当に「含む」ことを再確認
        if (z.name && z.name.includes(key)) ids.add(z.id);
      });
    }
    ZOO_IDS_BY_NAME_CACHE.set(key, Array.from(ids));
  } catch (e) {}
  return Array.from(ids);
}

async function fetchNewsForBaby(baby) {
  if (USE_MOCK || !baby || !baby.zoo_id) return [];
  try {
    const zooIds = await resolveAllZooIds(baby);
    if (!zooIds.length) return [];
    
    // 全 zoo_id をまとめて検索
    const ids = zooIds.map(encodeURIComponent).join(',');
    const url = `/rest/v1/news_items?select=id,title,url,published_at,source_name,thumbnail_url&zoo_id=in.(${ids})&order=published_at.desc&limit=80`;
    let data = await sbFetch(url);
    
    // フォールバック: source 経由
    if (!Array.isArray(data) || data.length === 0) {
      try {
        const srcs = await sbFetch(`/rest/v1/sources?select=id&zoo_id=in.(${ids})&enabled=eq.true&limit=30`);
        if (Array.isArray(srcs) && srcs.length > 0) {
          const sids = srcs.map(s => s.id).filter(Boolean).join(',');
          if (sids) {
            data = await sbFetch(`/rest/v1/news_items?select=id,title,url,published_at,source_name,thumbnail_url&source_id=in.(${sids})&order=published_at.desc&limit=80`);
          }
        }
      } catch (e) {}
    }
    
    if (!Array.isArray(data) || !data.length) return [];

    // 重複排除（同じ url を含む news）
    const seenUrls = new Set();
    const deduped = data.filter(n => {
      if (!n.url || seenUrls.has(n.url)) return false;
      seenUrls.add(n.url);
      return true;
    });

    // フィルタ: タイトル品質
    const relevant = deduped.filter(n => isAnimalNewsTitle(n.title, baby));
    if (!relevant.length) return [];

    // スコア: name strong match を上位に
    const scored = relevant.map(n => ({
      ...n,
      _score: isNameStrongMatch(n.title, baby) ? 0 : 1,
    }));
    scored.sort((a, b) => {
      if (a._score !== b._score) return a._score - b._score;
      return (b.published_at || '').localeCompare(a.published_at || '');
    });
    return scored.slice(0, 5);
  } catch (e) {
    return [];
  }
}

// ─── メイン ─────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  if (USE_MOCK) {
    console.log('🐾 どうベビ SSG 開始（--mock モード: サンプルデータを使用）\n');
  } else {
    console.log('🐾 どうベビ SSG 開始\n');
  }

  // ── データ取得 ──
  console.log(USE_MOCK ? '📂 モックデータ読み込み中...' : '📡 Supabase からデータ取得中...');

  let babies = [];
  let newsItems = [];

  try {
    babies = await fetchBabies();
  } catch (e) {
    console.error(`   ❌ 赤ちゃんデータ取得失敗: ${e.message}`);
  }
  try {
    newsItems = await fetchNews();
  } catch (e) {
    console.warn(`   ⚠️  ニュース取得失敗: ${e.message}`);
  }

  // ── slug マップ構築 ──
  const slugMap = buildSlugMap(babies);

  // ── 赤ちゃん個別ページ（slug URL + UUID リダイレクトスタブ）──
  console.log(`\n🐣 赤ちゃん個別ページ生成中 (${babies.length} 件)...`);
  console.log(`   📰 各赤ちゃんに紐づく最新ニュースを取得中...`);
  let babyCount = 0;
  let withNewsCount = 0;
  for (const b of babies) {
    if (!b.id) continue;
    const slug = slugMap.get(b.id);
    // この baby に紐づくニュース（zoo_id経由）を取得
    const babyNews = await fetchNewsForBaby(b);
    if (babyNews.length > 0) withNewsCount++;
    // slug URL に正規ページを生成
    writeHtml(path.join(WEB_DIR, 'babies', slug, 'index.html'), babyHtml(b, slug, babies, slugMap, babyNews));
    // UUID URL にリダイレクトスタブを生成（既存リンクの後方互換）
    writeHtml(path.join(WEB_DIR, 'babies', String(b.id), 'index.html'), babyRedirectHtml(slug));
    babyCount++;
    if (babyCount % 20 === 0) process.stdout.write(`   ${babyCount}/${babies.length}\n`);
  }
  console.log(`   ✅ ${babyCount} 件完了（うち ${withNewsCount} 件はニュース付き / slug + UUID スタブ）`);

  // ── ニュース個別ページ ──
  console.log(`\n🗞️  ニュース個別ページ生成中 (${newsItems.length} 件)...`);
  let newsCount = 0;
  for (const item of newsItems) {
    if (!item.id) continue;
    writeHtml(path.join(WEB_DIR, 'news', String(item.id), 'index.html'), newsHtml(item));
    newsCount++;
    if (newsCount % 100 === 0) process.stdout.write(`   ${newsCount}/${newsItems.length}\n`);
  }
  console.log(`   ✅ ${newsCount} 件完了`);

  // ── 動物園個別ページ ──
  console.log(`\n🏛️  動物園個別ページ生成中 (${ZOOS.length} 園)...`);
  let zooCount = 0;
  for (const zoo of ZOOS) {
    writeHtml(path.join(WEB_DIR, 'zoos', zoo.slug, 'index.html'), zooHtml(zoo, babies, slugMap));
    zooCount++;
  }
  console.log(`   ✅ ${zooCount} 園完了`);

  // ── 動物園一覧ページ ──
  console.log(`\n🏛️  動物園一覧ページ生成中...`);
  writeHtml(path.join(WEB_DIR, 'zoos', 'index.html'), zooIndexHtml(babies));
  console.log(`   ✅ /zoos/ 出力`);

  // ── 動物園マスターデータ JSON（babies.js の動物園フィルタ用） ──
  const zoosJsonPath = path.join(WEB_DIR, 'assets', 'data', 'zoos.json');
  fs.mkdirSync(path.dirname(zoosJsonPath), { recursive: true });
  const zoosJson = ZOOS.map(z => ({ db_name: z.db_name, name: z.name, prefecture: z.prefecture }));
  fs.writeFileSync(zoosJsonPath, JSON.stringify(zoosJson, null, 2) + '\n', 'utf-8');
  console.log(`   ✅ /assets/data/zoos.json 出力（${zoosJson.length}園）`);

  // ── 赤ちゃん一覧ページ（SSG） ──
  console.log(`\n🐣 赤ちゃん一覧ページ生成中...`);
  writeHtml(path.join(WEB_DIR, 'babies', 'index.html'), babiesIndexHtml(babies, slugMap));
  console.log(`   ✅ /babies/ 出力（${Math.min(babies.length, 48)}件 事前レンダリング）`);

  // ── ニュース一覧ページ（SSG） ──
  console.log(`\n🗞️  ニュース一覧ページ生成中...`);
  writeHtml(path.join(WEB_DIR, 'news', 'index.html'), newsIndexHtml(newsItems));
  console.log(`   ✅ /news/ 出力（${Math.min(newsItems.length, 36)}件 事前レンダリング）`);

  // ── 動物種別ページ ──
  console.log('\n🐾 動物種別ページ生成中...');
  const speciesSetForPages = new Set(babies.map(b => b.species).filter(Boolean));
  let speciesCount = 0;
  for (const sp of speciesSetForPages) {
    writeHtml(path.join(WEB_DIR, 'species', sp, 'index.html'), speciesHtml(sp, babies, slugMap));
    speciesCount++;
  }
  writeHtml(path.join(WEB_DIR, 'species', 'index.html'), speciesIndexHtml(babies));
  console.log(`   ✅ ${speciesCount}種 + 一覧1`);

  // ── 地域（エリア）別ハブ ──
  console.log('\n🗾 エリア別ハブ生成中...');
  const __areaData = areaRegionData(babies);
  writeHtml(path.join(WEB_DIR, 'area', 'index.html'), areaIndexHtml(babies, slugMap, __areaData));
  for (const __rn of __areaData.order) {
    writeHtml(path.join(WEB_DIR, 'area', __rn, 'index.html'), areaRegionHtml(__rn, __areaData.regionMap.get(__rn), babies.length, slugMap, __areaData.order));
  }
  console.log('   ✅ /area/ 出力');

  // ── 春の特集ページ ──
  console.log('\n🌸 2026年春特集ページ生成中...');
  writeHtml(path.join(WEB_DIR, 'specials', 'spring-2026', 'index.html'), springSpecialHtml(babies, slugMap));
  console.log(`   ✅ /specials/spring-2026/ 出力`);

  // ── 絶滅危惧種の赤ちゃん特集ページ ──
  console.log('\n🌍 絶滅危惧種特集ページ生成中...');
  writeHtml(path.join(WEB_DIR, 'specials', 'endangered', 'index.html'), endangeredSpecialHtml(babies, slugMap));
  console.log(`   ✅ /specials/endangered/ 出力`);

  // ── 特集ハブ一覧ページ ──
  console.log('\n📚 特集ハブ一覧ページ生成中...');
  writeHtml(path.join(WEB_DIR, 'specials', 'index.html'), specialsIndexHtml(babies));
  console.log(`   ✅ /specials/ 出力`);

  // ── サイトマップ ──
  // ── HTMLサイトマップ ──
  console.log('\n📄 sitemap.html 生成中...');
  writeHtml(path.join(WEB_DIR, 'sitemap', 'index.html'), buildSitemapHtml(babies, newsItems, slugMap));
  console.log(`   ✅ /sitemap/ 出力`);

  console.log('\n🗺️  sitemap.xml 生成中...');
  const sitemapXml = buildSitemap(babies, newsItems, slugMap);
  writeHtml(path.join(WEB_DIR, 'sitemap.xml'), sitemapXml);
  // sitemap-v2.xml は 1 本化（PROP-20260604-01）により廃止。/_redirects で 301 集約。
  console.log(`   ✅ ${babyCount + newsCount + zooCount + 5} URL を出力`);

  // ── baby-slugs.json（JS 側のリンク生成に使用） ──
  const slugsJsonPath = path.join(WEB_DIR, 'assets', 'data', 'baby-slugs.json');
  const slugsJson = babies
    .filter(b => b.id && slugMap.has(b.id))
    .map(b => ({ id: b.id, slug: slugMap.get(b.id) }));
  fs.writeFileSync(slugsJsonPath, JSON.stringify(slugsJson) + '\n', 'utf-8');
  console.log(`   ✅ /assets/data/baby-slugs.json 出力（${slugsJson.length}件）`);

  // ── _redirects の UUID 301 セクション更新（本番 SSG のみ） ──
  if (!USE_MOCK) {
    console.log('\n🔀 _redirects UUID 301リダイレクト更新中...');
    updateRedirects(slugMap);
    console.log(`   ✅ ${slugMap.size} 件の UUID→slug 301リダイレクト更新`);
  }

  // ── index.html SSG注入（新着の赤ちゃん・最新ニュース） ──
  console.log('\n🏠 index.html SSG注入中...');
  patchIndexHtml(babies, newsItems, slugMap);
  console.log('   ✅ index.html 新着セクション注入完了');

  // ── calendar/index.html SSG注入 ──
  console.log('\n📅 calendar/index.html SSG注入中...');
  patchCalendarHtml(babies, slugMap);
  console.log('   ✅ calendar/index.html 当月カレンダー注入完了');

  // ── 静的 HTML の GA4 ID 差し替え ──────────────────────────────────
  // SSG で生成したページは既に GA_ID を埋め込み済み。
  // 手書きの静的ページ（index.html 等）は G-YRQJXRMEN2 プレースホルダのままなので
  // 実際の計測 ID が環境変数で渡された場合のみ差し替える。
  if (GA_ID !== 'G-YRQJXRMEN2') {
    const staticHtmlFiles = [
      'web/index.html',
      'web/babies/index.html',
      'web/news/index.html',
      'web/news/article.html',
      'web/calendar/index.html',
      'web/privacy/index.html',
      'web/zoos/index.html',
    ];
    let patchCount = 0;
    for (const rel of staticHtmlFiles) {
      const absPath = path.resolve(__dirname, '..', rel);
      if (!fs.existsSync(absPath)) continue;
      const original = fs.readFileSync(absPath, 'utf-8');
      const patched  = original.replaceAll('G-YRQJXRMEN2', GA_ID);
      if (patched !== original) {
        fs.writeFileSync(absPath, patched, 'utf-8');
        patchCount++;
      }
    }
    if (patchCount > 0) console.log(`   GA4 ID を静的ページ ${patchCount} 件に適用 (${GA_ID})`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n🎉 SSG 完了 (${elapsed}s)`);
  console.log(`   赤ちゃんページ: ${babyCount} 件`);
  console.log(`   ニュースページ: ${newsCount} 件`);
  console.log(`   動物園ページ:   ${zooCount} 園 + 一覧1`);
  console.log(`   合計: ${babyCount + newsCount + zooCount + 1} ページ生成`);
}

main().catch(err => {
  console.error('\n❌ SSG エラー:', err);
  process.exit(1);
});
