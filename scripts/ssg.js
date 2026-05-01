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
const SITE_BASE  = 'https://babyanimals.pages.dev';

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

function htmlHead({ title, desc, ogImage, canonical, jsonLd }) {
  const og = ogImage || `${SITE_BASE}/assets/img/og.png`;
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${esc(og)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:site_name" content="どうベビ" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml" />
  <meta name="google-site-verification" content="yqP_OZz3Qm_iPw3wLSlhofOmYHwrFf3CyU7psadeE-U" />
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
  <small>© どうベビ（動物園ベビー情報）　<a href="/privacy/" style="color:inherit;opacity:0.7;font-size:0.9em;">プライバシーポリシー</a></small>
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
      ${svgTicket} オンラインチケットを予約する <small class="zoo-link__pr">PR</small>
    </a>`);
  }
  if (data.official_url) {
    buttons.push(`<a class="zoo-link zoo-link--official"
         href="${esc(data.official_url)}"
         target="_blank" rel="noopener noreferrer"
         data-link-type="official"
         data-zoo-name="${safeZoo}"
         data-animal-name="${safeAnimal}">
      ${svgMapPin} アクセス・営業時間
    </a>`);
  }
  if (!buttons.length) return '';

  return `<div class="zoo-links" aria-label="${safeZoo}へのリンク">${buttons.join('\n    ')}</div>`;
}

// ─── 赤ちゃん個別ページ ─────────────────────────────────────────────

function babyHtml(b, slug, allBabies, slugMap) {
  const name     = b.name    || '赤ちゃん';
  const species  = b.species || '動物';
  const zoo      = b.zoo_name || '（動物園不明）';
  const bdayFmt  = fmtDate(b.birthday);
  const age      = ageText(b.birthday);
  const birthdayYear = b.birthday ? new Date(b.birthday).getFullYear() : null;
  const canonical = `${SITE_BASE}/babies/${slug}/`;

  const title = `${name}（${species}）の赤ちゃん｜${zoo}`;
  const desc  = `${zoo}で${birthdayYear ? `${birthdayYear}年に` : ''}生まれた${species}の赤ちゃん「${name}」。誕生日は${bdayFmt || '不明'}、現在${age}。どうベビで動物園の赤ちゃん情報をチェック。`;

  const articleLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${name}（${species}）の赤ちゃん｜${zoo}`,
    description: desc,
    image: b.thumbnail_url || `${SITE_BASE}/assets/img/og.png`,
    url: canonical,
    datePublished: b.birthday || undefined,
    publisher: { '@type': 'Organization', name: 'どうベビ', url: SITE_BASE },
  });

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
    ? `<img class="ssg-detail__img" src="${esc(b.thumbnail_url)}" alt="${esc(name)}（${esc(species)}）" loading="eager" decoding="async">`
    : `<div class="ssg-detail__img ssg-detail__img--placeholder" role="img" aria-label="写真なし">🐾</div>`;

  // 同じ動物園の赤ちゃん（最大6件）
  const sameZoo = (allBabies || [])
    .filter(x => x.zoo_name === b.zoo_name && x.id !== b.id)
    .slice(0, 6);

  // 同じ種別の赤ちゃん（同動物園は除外、最大6件）
  const sameSpecies = (allBabies || [])
    .filter(x => x.species === b.species && x.id !== b.id && x.zoo_name !== b.zoo_name)
    .slice(0, 6);

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

  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, ogImage: b.thumbnail_url, canonical, jsonLd: articleLd })}
<script type="application/ld+json">${breadcrumbLd}</script>
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
      ${zooLinksHtml(zoo, name)}
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
${htmlHead({ title: pageTitle, desc, ogImage: item.thumbnail_url, canonical, jsonLd })}
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
        </div>
      </div>
    </a>
  </div>`;
}

/**
 * 動物園個別ページ HTML
 */
function zooHtml(zoo, babies, slugMap = null) {
  const zooBabies = babies.filter(b => b.zoo_name === zoo.db_name);
  const count = zooBabies.length;
  const sampleNames = zooBabies.slice(0, 3).map(b => b.name).filter(Boolean).join('・');

  const title = `${zoo.name}の赤ちゃん動物一覧 | どうベビ`;
  const desc = count > 0
    ? `${zoo.name}で現在会える赤ちゃん動物を紹介。${sampleNames}${count > 3 ? 'など' : ''}${count}頭が暮らしています。${zoo.description || ''}`.slice(0, 160)
    : `${zoo.name}の動物・アクセス・営業時間・入園料のご案内。${zoo.description || ''}`.slice(0, 160);
  const canonical = `${SITE_BASE}/zoos/${zoo.slug}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Zoo',
    name: zoo.name,
    description: zoo.description || desc,
    url: canonical,
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

  // アフィリエイト / 公式リンク
  const svgTicket2 = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-ticket"></use></svg>`;
  const svgMapPin2 = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-map-pin"></use></svg>`;
  const ticketBtn = zoo.asoview_url
    ? `<a class="zoo-link zoo-link--ticket"
           href="${esc(zoo.asoview_url)}"
           target="_blank" rel="noopener sponsored"
           data-link-type="ticket"
           data-zoo-name="${esc(zoo.db_name)}">
        🎟️ オンラインチケットを予約する <small class="zoo-link__pr">PR</small>
      </a>`
    : '';
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
${htmlHead({ title, desc, canonical, jsonLd })}
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
  </section>

  <nav class="zoo-jump" aria-label="都道府県ジャンプ">
    ${jumpLinks}
  </nav>

  ${sections}

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



function buildSitemap(babies, newsItems, slugMap) {
  const today = new Date().toISOString().slice(0, 10);

  const staticUrls = [
    { loc: `${SITE_BASE}/`,           priority: '1.0', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/babies/`,    priority: '0.9', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/news/`,      priority: '0.9', changefreq: 'daily',   lastmod: today },
    { loc: `${SITE_BASE}/zoos/`,      priority: '0.9', changefreq: 'weekly',  lastmod: today },
    { loc: `${SITE_BASE}/calendar/`,  priority: '0.8', changefreq: 'weekly',  lastmod: today },
  ];

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

  const allUrls = [...staticUrls, ...zooUrls, ...babyUrls, ...newsUrls];
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

  html = patchSection(html, 'recent', `\n${recentHtml}\n`);
  html = patchSection(html, 'news', `\n${newsHtml}\n`);
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

async function fetchBabies() {
  if (USE_MOCK) {
    // モック: 赤ちゃんサンプルデータ（--mock フラグ時）
    return [
      { id: 'demo-baby-001', name: 'レオ',   species: 'ライオン',    birthday: '2024-03-15', zoo_name: 'サンプル動物園', thumbnail_url: null },
      { id: 'demo-baby-002', name: 'パンちゃん', species: 'ジャイアントパンダ', birthday: '2023-09-01', zoo_name: 'サンプル動物園', thumbnail_url: null },
      { id: 'demo-baby-003', name: 'ぺんた', species: 'ペンギン',    birthday: '2025-01-10', zoo_name: 'デモ水族館',     thumbnail_url: null },
    ];
  }
  try {
    const data = await sbFetch('/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo_name&order=birthday.desc.nullslast&limit=500');
    console.log(`   ✅ 赤ちゃん: ${data.length} 件`);
    return data;
  } catch (e) {
    console.warn(`   ⚠️  babies_public 失敗 — babies テーブルで再試行 (${e.message})`);
    const raw = await sbFetch('/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo:zoos(name)&order=birthday.desc.nullslast&limit=500');
    const data = raw.map(x => ({ ...x, zoo_name: x.zoo?.name || '' }));
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
  let babyCount = 0;
  for (const b of babies) {
    if (!b.id) continue;
    const slug = slugMap.get(b.id);
    // slug URL に正規ページを生成
    writeHtml(path.join(WEB_DIR, 'babies', slug, 'index.html'), babyHtml(b, slug, babies, slugMap));
    // UUID URL にリダイレクトスタブを生成（既存リンクの後方互換）
    writeHtml(path.join(WEB_DIR, 'babies', String(b.id), 'index.html'), babyRedirectHtml(slug));
    babyCount++;
    if (babyCount % 100 === 0) process.stdout.write(`   ${babyCount}/${babies.length}\n`);
  }
  console.log(`   ✅ ${babyCount} 件完了（slug + UUID スタブ 各${babyCount}件）`);

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

  // ── サイトマップ ──
  console.log('\n🗺️  sitemap.xml 生成中...');
  writeHtml(path.join(WEB_DIR, 'sitemap.xml'), buildSitemap(babies, newsItems, slugMap));
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
