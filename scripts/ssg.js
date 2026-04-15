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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&display=swap" />
  <link rel="stylesheet" href="/assets/css/style.css" />
  <!-- Google tag (gtag.js) — GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  </script>
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
      ${svgTicket} チケットを見る
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

function babyHtml(b) {
  const name     = b.name    || '赤ちゃん';
  const species  = b.species || '動物';
  const zoo      = b.zoo_name || '（動物園不明）';
  const bdayFmt  = fmtDate(b.birthday);
  const age      = ageText(b.birthday);
  const canonical = `${SITE_BASE}/babies/${b.id}/`;

  const title = `${name}（${species}）の赤ちゃん | どうベビ`;
  const desc  = `${zoo}で生まれた${species}の赤ちゃん「${name}」。誕生日は${bdayFmt || '不明'}、現在${age}。動物園ファン向けベビー情報サイト「どうベビ」でチェック。`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${name}（${species}）の赤ちゃん情報`,
    description: desc,
    image: b.thumbnail_url || `${SITE_BASE}/assets/img/og.png`,
    url: canonical,
    datePublished: b.birthday || undefined,
    publisher: { '@type': 'Organization', name: 'どうベビ', url: SITE_BASE },
  });

  const thumbHtml = b.thumbnail_url
    ? `<img class="ssg-detail__img" src="${esc(b.thumbnail_url)}" alt="${esc(name)}（${esc(species)}）" loading="eager" decoding="async">`
    : `<div class="ssg-detail__img ssg-detail__img--placeholder" role="img" aria-label="写真なし">🐾</div>`;


  return `<!doctype html>
<html lang="ja">
${htmlHead({ title, desc, ogImage: b.thumbnail_url, canonical, jsonLd })}
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
        ${esc(zoo)}で生まれた${esc(species)}の赤ちゃんです。
        誕生日は${esc(bdayFmt) || '不明'}、現在${esc(age)}。
      </p>
      ${zooLinksHtml(zoo, name)}
      <div class="ssg-detail__actions">
        <a class="btn btn--primary" href="/babies/">← 赤ちゃん一覧へ戻る</a>
      </div>
    </div>
  </article>

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
function zooBabyCardHtml(b) {
  const name     = b.name || '（名前未判明）';
  const species  = b.species || '';
  // 名前の中に既に種別が含まれている場合（旧データの '赤ちゃん（X）'）は種別を重複表示しない
  const showSpecies = species && !(b.name || '').includes(species);
  const bdayFmt  = fmtDate(b.birthday);
  const age      = ageText(b.birthday);
  const href     = `/babies/${b.id}/`;
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
function zooHtml(zoo, babies) {
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
        ${svgTicket2} チケットを予約する
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
    ? `<div class="baby-grid">${zooBabies.map(zooBabyCardHtml).join('')}</div>`
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
    return `<section class="zoo-prefecture">
      <h2 class="zoo-prefecture__title">${esc(g.prefecture)}</h2>
      <div class="zoo-card-grid">${cards}</div>
    </section>`;
  }).join('');

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

  ${sections}

</main>
${siteFooter()}
<script defer src="/assets/js/analytics.js"></script>
</body>
</html>`;
}

// ─── サイトマップ ────────────────────────────────────────────────────

function buildSitemap(babies, newsItems) {
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
    loc:        `${SITE_BASE}/babies/${b.id}/`,
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
    <loc>${u.loc}</loc>
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

  // ── 赤ちゃん個別ページ ──
  console.log(`\n🐣 赤ちゃん個別ページ生成中 (${babies.length} 件)...`);
  let babyCount = 0;
  for (const b of babies) {
    if (!b.id) continue;
    writeHtml(path.join(WEB_DIR, 'babies', String(b.id), 'index.html'), babyHtml(b));
    babyCount++;
    if (babyCount % 100 === 0) process.stdout.write(`   ${babyCount}/${babies.length}\n`);
  }
  console.log(`   ✅ ${babyCount} 件完了`);

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
    writeHtml(path.join(WEB_DIR, 'zoos', zoo.slug, 'index.html'), zooHtml(zoo, babies));
    zooCount++;
  }
  console.log(`   ✅ ${zooCount} 園完了`);

  // ── 動物園一覧ページ ──
  console.log(`\n🏛️  動物園一覧ページ生成中...`);
  writeHtml(path.join(WEB_DIR, 'zoos', 'index.html'), zooIndexHtml(babies));
  console.log(`   ✅ /zoos/ 出力`);

  // ── サイトマップ ──
  console.log('\n🗺️  sitemap.xml 生成中...');
  writeHtml(path.join(WEB_DIR, 'sitemap.xml'), buildSitemap(babies, newsItems));
  console.log(`   ✅ ${babyCount + newsCount + zooCount + 5} URL を出力`);

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
