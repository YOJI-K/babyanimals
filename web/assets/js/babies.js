// assets/js/babies.js
// Babies list v3 — ヘッダー/タブ統一, 年齢フィルタ(0-3), 近い誕生日順, 可愛いNo Image, スピナー, ページサイズ可変

// ── 動物園アフィリエイトデータ ──────────────────────────────────────
// ※ マスターデータは scripts/zoos-data.js です。
//   ブラウザでは ES module import を使わずベタ書き（CDN不要で軽量化優先）。
//   zoos-data.js を更新したときは、このマップも同期してください。
// official_url: 動物園公式サイト
// asoview_url:  アソビューアフィリエイトリンク（null = 非表示）
const ZOO_AFFILIATE_MAP = {
  '上野動物園':     { official_url: 'https://www.tokyo-zoo.net/zoo/ueno/',                         asoview_url: null },
  '多摩動物公園':   { official_url: 'https://www.tokyo-zoo.net/zoo/tama/',                         asoview_url: null },
  '旭山動物園':     { official_url: 'https://www.city.asahikawa.hokkaido.jp/asahiyamazoo/',        asoview_url: null },
  '札幌市円山動物園': { official_url: 'https://www.city.sapporo.jp/zoo/',                          asoview_url: null },
  '神戸どうぶつ王国': { official_url: 'https://www.kobe-oukoku.com/',                              asoview_url: null },
  '天王寺動物園':   { official_url: 'https://www.tennojizoo.jp/',                                  asoview_url: null },
  '東山動植物園':   { official_url: 'https://www.higashiyama.city.nagoya.jp/',                     asoview_url: null },
  'ズーラシア':     { official_url: 'https://www.hama-midorinokyokai.or.jp/zoo/zoorasia/',         asoview_url: null },
};

(() => {
  // ====== 小ユーティリティ ======
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));
  const today = () => new Date();

  const Site = window.Site || {};
  Site.fmtDate = Site.fmtDate || function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };
  const log = (...a) => { /* console.log('[babies]', ...a); */ };
  const debounce = (fn, ms) => { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; };

  function getPageSize() {
    const sp = new URLSearchParams(location.search);
    const qp = Number(sp.get('pagesize'));
    if (!Number.isNaN(qp) && qp >= 1 && qp <= 50) return qp;
    const fromData = Number(document.body?.dataset?.pageSize);
    return (!Number.isNaN(fromData) && fromData >= 1) ? fromData : 12;
  }

  // 年齢（年月日差）
  function calcAgeYMD(birthday, at = today()){
    if (!birthday) return null;
    const b = new Date(birthday); if (Number.isNaN(b)) return null;
    let y = at.getFullYear() - b.getFullYear();
    let m = at.getMonth() - b.getMonth();
    let d = at.getDate() - b.getDate();
    if (d < 0) { m--; d += new Date(at.getFullYear(), at.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
  }
  function nextBirthdayDays(birthday, at = today()){
    if (!birthday) return Infinity;
    const b = new Date(birthday); if (Number.isNaN(b)) return Infinity;
    const curr = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const next = new Date(at.getFullYear(), b.getMonth(), b.getDate());
    if (next < curr) next.setFullYear(next.getFullYear() + 1);
    return Math.round((next - curr) / 86400000);
  }
  function ageText(birthday){
    const a = calcAgeYMD(birthday); if (!a) return '';
    if (a.y === 0) return `0歳${a.m>0 ? `（${a.m}か月）` : ''}`;
    return `${a.y}歳`;
  }

  // ====== ノード ======
  const $q      = $('q');
  const $zoo    = $('zoo');
  const $sort   = $('sort');
  const $list   = $('list');
  const $empty  = $('empty');
  const $skel   = $('skeleton-babies');
  const $error  = $('error');
  const $more   = $('more');

  // ====== 状態 ======
  let PAGE_SIZE = getPageSize();
  let PAGE = 1;
  let AGE_FILTER = ''; // '', '0','1','2','3'
  let BABIES = [];
  let ZOOS = [];
  let ID_TO_SLUG = {}; // id → slug
  let SLUG_TO_ID = {}; // slug → id

  // ====== Supabase ======
  function getSupabaseEnv(){
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
    const URL = (window.SUPABASE && (window.SUPABASE.URL || window.SUPABASE.SUPABASE_URL))
      || metaUrl
      || 'https://hvhpfrksyytthupboaeo.supabase.co';
    const ANON = (window.SUPABASE && (window.SUPABASE.ANON || window.SUPABASE.SUPABASE_ANON_KEY))
      || metaKey
      || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY';
    return { URL, ANON };
  }
  async function fetchJSON(u){
    const { URL: SUPA_URL, ANON } = getSupabaseEnv();
    if(!SUPA_URL || !ANON) throw new Error('Supabase の URL / ANON KEY が設定されていません。');
    const url = new URL(u, SUPA_URL);
    const res = await fetch(url.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Accept-Profile':'public', 'Content-Profile':'public' },
      cache: 'no-store'
    });
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status} @ ${url.pathname}: ${t}`);
    }
    return res.json();
  }

  async function loadZoos(){
    try{
      const res = await fetch('/assets/data/zoos.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const master = await res.json(); // [{db_name, name, prefecture}] in zoos-data.js order
      ZOOS = master;
      if ($zoo) {
        const byPref = new Map();
        const prefOrder = [];
        for (const z of master) {
          if (!byPref.has(z.prefecture)) { prefOrder.push(z.prefecture); byPref.set(z.prefecture, []); }
          byPref.get(z.prefecture).push(z);
        }
        const groupsHtml = prefOrder.map(pref => {
          const opts = byPref.get(pref).map(z => `<option value="${z.db_name}">${z.name}</option>`).join('');
          return `<optgroup label="${pref}">${opts}</optgroup>`;
        }).join('');
        $zoo.innerHTML = `<option value="">すべての動物園</option>${groupsHtml}`;
      }
    }catch(e){
      console.warn('[zoos] fallback: continue without zoo list', e);
      ZOOS = [];
    }
  }
  // babies_public → babies(embed) → babies(plain)
  async function loadBabies(){
    try{
      BABIES = await fetchJSON('/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo_name&order=birthday.desc.nullslast&limit=500');
      return;
    }catch(e1){
      console.warn('[babies_public] failed, try embed', e1);
    }
    try{
      const data = await fetchJSON('/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,zoo_id,zoo:zoos(name)&order=birthday.desc.nullslast&limit=500');
      BABIES = (data||[]).map(x => ({
        id:x.id, name:x.name, species:x.species, birthday:x.birthday,
        thumbnail_url:x.thumbnail_url, zoo_id:x.zoo_id, zoo_name:x.zoo?.name || ''
      }));
      return;
    }catch(e2){
      console.warn('[babies embed] failed, try plain', e2);
    }
    const data = await fetchJSON('/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,zoo_id&order=birthday.desc.nullslast&limit=500');
    BABIES = (data||[]).map(x => ({ ...x, zoo_name:'' }));
  }

  async function loadSlugMap(){
    try{
      const arr = await fetch('/assets/data/baby-slugs.json').then(r=>r.json());
      arr.forEach(({id,slug})=>{ ID_TO_SLUG[id]=slug; SLUG_TO_ID[slug]=id; });
    }catch(e){ /* slug map なくても UUID フォールバックで動作する */ }
  }

  // ====== ビュー ======
  function sourcePillZoo(name){ return `<span class="pill pill--zoo">🏛️ ${name || '園情報なし'}</span>`; }
  function pillBirthday(iso){ return `<span class="pill">🎂 ${Site.fmtDate(iso) || '—'}</span>`; }
  function pillAge(iso){
    const a = calcAgeYMD(iso);
    if (!a) return `<span class="pill pill--muted">年齢不明</span>`;
    const y = Math.min(a.y, 3);
    return `<span class="pill pill--age-${y}">${a.y}歳${a.y===0 && a.m>0 ? `（${a.m}か月）` : ''}</span>`;
  }

  function cardHTML(x){
    const title = x.name || '（名前未判明）';
    const zoo   = x.zoo_name || '';
    // 名前の中に既に種別が含まれている場合（例: 旧データの '赤ちゃん（マンドリル）'）は種別を重複表示しない
    const showSpecies = x.species && !(x.name || '').includes(x.species);
    const alt   = [x.name || '名前未判明', x.species].filter(Boolean).join('（') + (x.species ? '）' : '');
    const soon  = x.birthday ? nextBirthdayDays(x.birthday) : Infinity;
    const isMonth = x.birthday ? (new Date(x.birthday).getMonth() === new Date().getMonth()) : false;
    const href  = `/babies/${ID_TO_SLUG[x.id] || x.id}/`;

    const thumb = x.thumbnail_url
      ? `<div class="thumb"><img src="${x.thumbnail_url}" loading="lazy" decoding="async" alt="${alt}"></div>`
      : `<div class="thumb is-placeholder" role="img" aria-label="画像なし"></div>`;

    // ── アフィリエイト / 公式リンクボタン ──────────────────────────
    const SVG_TICKET  = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-ticket"></use></svg>`;
    const SVG_MAPPIN  = `<svg class="btn-icon" aria-hidden="true" focusable="false"><use href="/assets/icons/icons.svg#icon-map-pin"></use></svg>`;
    const zooData = ZOO_AFFILIATE_MAP[zoo] || {};
    let ticketBtn = '';
    if (zooData.asoview_url) {
      ticketBtn = `<div class="baby-card__foot">
        <a href="${zooData.asoview_url}" class="baby-card__ticket"
           target="_blank" rel="noopener sponsored"
           data-link-type="ticket"
           data-zoo-name="${zoo}"
           data-animal-name="${x.name || ''}">${SVG_TICKET} チケットを見る</a>
      </div>`;
    } else if (zooData.official_url) {
      ticketBtn = `<div class="baby-card__foot">
        <a href="${zooData.official_url}" class="baby-card__ticket baby-card__ticket--official"
           target="_blank" rel="noopener noreferrer"
           data-link-type="official"
           data-zoo-name="${zoo}"
           data-animal-name="${x.name || ''}">${SVG_MAPPIN} 公式サイト</a>
      </div>`;
    }

    return `
      <div class="baby-card">
        <a href="${href}" class="baby-card__link" aria-label="${title}（${x.species || '種別不明'}、${zoo || '園情報なし'}）の詳細">
          ${thumb}
          ${soon <= 14 ? `<span class="soon-dot" title="もうすぐお誕生日"></span>` : ''}
          <div class="pad">
            <div class="title">${title}${showSpecies ? `（${x.species}）` : ''}</div>
            <div class="meta">
              ${sourcePillZoo(zoo)}
              ${pillBirthday(x.birthday)}
              ${pillAge(x.birthday)}
              ${soon <= 14 ? '<span class="pill pill--soon">もうすぐ</span>' : ''}
              ${isMonth ? '<span class="pill pill--month">今月🎂</span>' : ''}
            </div>
          </div>
        </a>
        ${ticketBtn}
      </div>
    `;
  }

  function bindImageFallback(scope){
    (scope || document).querySelectorAll('.thumb img').forEach(img=>{
      img.addEventListener('error', ()=>{
        const wrap = img.closest('.thumb'); if (!wrap) return;
        wrap.classList.add('is-placeholder');
        img.remove();
        wrap.setAttribute('role','img');
        wrap.setAttribute('aria-label','画像なし');
      }, { once:true, passive:true });
    });
  }

  // ====== フィルタ & ソート ======
  function filteredData(){
    const q = ($q?.value || '').trim().toLowerCase();
    const zooDbName = $zoo?.value || '';
    let data = BABIES.slice();

    if (q) {
      data = data.filter(x =>
        (x.name || '').toLowerCase().includes(q) ||
        (x.species || '').toLowerCase().includes(q) ||
        (x.zoo_name || '').toLowerCase().includes(q)
      );
    }
    if (zooDbName) {
      data = data.filter(x => (x.zoo_name || '') === zooDbName);
    }
    if (AGE_FILTER !== '') {
      data = data.filter(x => {
        const a = calcAgeYMD(x.birthday);
        return a && a.y === Number(AGE_FILTER);
      });
    }

    const sort = $sort?.value || 'desc';
    if (sort === 'near') {
      data.sort((a,b) => nextBirthdayDays(a.birthday) - nextBirthdayDays(b.birthday));
    } else {
      const asc = (sort === 'asc');
      data.sort((a,b) => {
        const ad = a.birthday ? new Date(a.birthday).getTime() : -Infinity;
        const bd = b.birthday ? new Date(b.birthday).getTime() : -Infinity;
        if (ad !== bd) return asc ? ad - bd : bd - ad;
        return asc ? (a.id > b.id ? 1 : -1) : (a.id < b.id ? 1 : -1);
      });
    }
    return data;
  }

  function updateMoreButton(total, shown){
    if (!$more) return;
    const hasMore = shown < total;
    $more.style.display = hasMore ? 'inline-flex' : 'none';
    $more.disabled = !hasMore;
  }

  function render(){
    if (!$list) return;
    $skel.style.display = 'none';

    const data = filteredData();
    const end = PAGE * PAGE_SIZE;
    const slice = data.slice(0, end);

    $list.innerHTML = slice.map(cardHTML).join('');
    bindImageFallback($list);

    $empty.style.display = slice.length ? 'none' : 'block';
    updateMoreButton(data.length, slice.length);

    if ($more) $more.classList.remove('loading');
    log('render:', slice.length, '/', data.length);
  }

  function showError(msg){
    if ($error) { $error.style.display = 'block'; $error.textContent = msg; }
  }

  // ====== 個別ページ（クライアントサイドフォールバック） ======
  function escHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function renderDetailPage(slugOrId){
    const $main = document.getElementById('main');
    if (!$main) return;

    // スケルトン表示
    $main.innerHTML = `<div class="ssg-detail" style="padding:40px 18px;text-align:center;color:#aaa;">読み込み中…</div>`;

    // slug → UUID の逆引き（baby-slugs.json ロード済みの場合）
    const id = SLUG_TO_ID[slugOrId] || slugOrId;

    let b;
    try{
      const rows = await fetchJSON(`/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_name&id=eq.${encodeURIComponent(id)}&limit=1`);
      b = rows && rows[0];
      if (!b) throw new Error('not found');
    }catch(e){
      console.warn('[detail fallback]', e);
      // 取得失敗 → 一覧にリダイレクト
      location.replace('/babies/');
      return;
    }

    const name      = b.name || '赤ちゃん';
    const species   = b.species || '動物';
    const zoo       = b.zoo_name || '';
    const bdayFmt   = Site.fmtDate(b.birthday);
    const ageInfo   = calcAgeYMD(b.birthday);
    const ageLabel  = ageInfo ? `${ageInfo.y}歳${ageInfo.y===0&&ageInfo.m>0?`（${ageInfo.m}か月）`:''}` : '年齢不明';
    const ageSuf    = ageInfo ? Math.min(ageInfo.y, 3) : '';

    document.title = `${name}（${species}）の赤ちゃん｜${zoo || 'どうベビ'}`;

    const thumb = b.thumbnail_url
      ? `<img class="ssg-detail__img" src="${escHtml(b.thumbnail_url)}" alt="${escHtml(name)}" loading="eager" decoding="async">`
      : `<div class="ssg-detail__img ssg-detail__img--placeholder" role="img" aria-label="写真なし">🐾</div>`;

    const zooData = ZOO_AFFILIATE_MAP[zoo] || {};
    let zooBtn = '';
    if (zooData.asoview_url)
      zooBtn = `<a class="btn btn--primary" href="${escHtml(zooData.asoview_url)}" target="_blank" rel="noopener sponsored" data-link-type="ticket">🎟️ チケットを見る</a>`;
    else if (zooData.official_url)
      zooBtn = `<a class="btn" href="${escHtml(zooData.official_url)}" target="_blank" rel="noopener noreferrer" data-link-type="official">🏛️ 公式サイト</a>`;

    $main.innerHTML = `
      <nav class="ssg-breadcrumb" aria-label="パンくず">
        <a href="/">ホーム</a> › <a href="/babies/">赤ちゃん一覧</a> › <span>${escHtml(name)}</span>
      </nav>
      <article class="ssg-detail">
        ${thumb}
        <div class="ssg-detail__body">
          <h1 class="ssg-detail__name">${escHtml(name)}<span class="ssg-detail__species">（${escHtml(species)}）</span></h1>
          <div class="ssg-detail__pills">
            ${zoo ? `<span class="pill pill--zoo">🏛️ ${escHtml(zoo)}</span>` : ''}
            <span class="pill">🎂 ${escHtml(bdayFmt)||'—'}</span>
            <span class="pill pill--age-${ageSuf}">🎈 ${escHtml(ageLabel)}</span>
          </div>
          <p class="ssg-detail__desc">
            ${zoo?escHtml(zoo)+'で生まれた':''}${escHtml(species)}の赤ちゃんです。
            誕生日は${escHtml(bdayFmt)||'不明'}、現在${escHtml(ageLabel)}。
          </p>
          <div class="ssg-detail__actions">
            ${zooBtn}
            <a class="btn btn--primary" href="/babies/">← 赤ちゃん一覧へ戻る</a>
          </div>
        </div>
      </article>`;
  }
  function setupAgeFilter(){
    const btns = $$('.age-filter .segmented__btn');
    btns.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        btns.forEach(b => { b.classList.remove('is-selected'); b.setAttribute('aria-checked','false'); });
        btn.classList.add('is-selected');
        btn.setAttribute('aria-checked','true');
        AGE_FILTER = btn.dataset.age || '';
        PAGE = 1; render();
      }, { passive:true });
    });
  }

  // ====== 初期化 ======
  (async function init(){
    if (window.__BABIES_V3_INITED) return;
    window.__BABIES_V3_INITED = true;

    // /babies/{slug-or-id}/ 形式ならクライアントサイドで個別ページを描画
    // （SSG生成 HTML が存在しない場合の _redirects フォールバック対応）
    const detailMatch = location.pathname.match(/^\/babies\/([^/]+)\/?$/);
    if (detailMatch) {
      await loadSlugMap(); // slug→UUID 逆引き用に先にロード
      return renderDetailPage(decodeURIComponent(detailMatch[1]));
    }

    try{
      $skel.style.display = 'grid';
      $error.style.display = 'none';

      await Promise.all([loadSlugMap(), loadZoos()]);
      await loadBabies();

      PAGE = 1;
      render();

      const onSearch = debounce(()=>{ PAGE = 1; render(); }, 160);
      $q?.addEventListener('input', onSearch, { passive:true });
      $zoo?.addEventListener('change', ()=>{ PAGE = 1; render(); }, { passive:true });
      $sort?.addEventListener('change', ()=>{ PAGE = 1; render(); }, { passive:true });
      $more?.addEventListener('click', (e)=>{ e.currentTarget.classList.add('loading'); PAGE += 1; render(); });

      setupAgeFilter();
    }catch(e){
      console.error(e);
      $skel.style.display = 'none';
      showError('読み込みエラーが発生しました。時間をおいて再度お試しください。');
    }
  })();
})();
