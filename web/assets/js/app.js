// assets/js/app.js
// Global enhancements + Supabase連携（home / news / babies / calendar）
// babies.zoo_id を用いて zoos.name を解決

(() => {
  /* =========================
   * 基本ユーティリティ
   * ========================= */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd  = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const stripTime = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay  = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);

  /* =========================
   * Supabase REST 設定
   * ========================= */
  const SUPABASE_URL = "https://hvhpfrksyytthupboaeo.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY";

  async function sbFetch(path){
    const url = `${SUPABASE_URL}${path}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        Prefer: "count=none"
      },
      method: "GET",
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> "");
      throw new Error(`Supabase fetch failed (${res.status}): ${text || url}`);
    }
    return res.json();
  }

  /* =========================
   * データ取得：babies / zoos
   * ========================= */

  // メモリキャッシュ：zoo_id -> {id,name,prefecture,city,website}
  const zooCache = new Map();

  /**
   * 必要なzoo_idだけを /zoos からまとめて取得してキャッシュする
   * @param {string[]} ids
   * @returns {Promise<void>}
   */
  async function ensureZoos(ids){
    const needed = ids.filter(id => id && !zooCache.has(id));
    if (needed.length === 0) return;

    // `id=in.(id1,id2,...)` を作成（URLエンコード必要）
    const inList = `(${needed.map(encodeURIComponent).join(',')})`;
    const path = `/rest/v1/zoos?select=id,name,prefecture,city,website&id=in.${encodeURIComponent(inList)}`;

    const rows = await sbFetch(path);
    for (const z of rows) {
      zooCache.set(z.id, z);
    }

    // 取得できなかったIDも空で埋めておく（無限リトライ防止）
    needed.forEach(id => { if (!zooCache.has(id)) zooCache.set(id, null); });
  }

  /**
   * babiesレコード配列に zoo 情報を付与（zoo: {name,...}）
   */
  async function attachZooInfo(babies){
    const ids = Array.from(new Set(babies.map(b => b.zoo_id).filter(Boolean)));
    await ensureZoos(ids);
    return babies.map(b => ({
      ...b,
      zoo: b.zoo_id ? zooCache.get(b.zoo_id) || null : null
    }));
  }

  /**
   * 指定年月（1-12）の誕生日を取得（昇順）
   */
  async function loadBabiesByMonth(year, month1to12){
    const start = `${year}-${pad2(month1to12)}-01`;
    const endDate = new Date(year, month1to12, 1); // 翌月1日
    const end   = `${endDate.getFullYear()}-${pad2(endDate.getMonth()+1)}-01`;

    const query = `/rest/v1/babies` +
      `?select=id,name,species,birthday,thumbnail_url,zoo_id` +
      `&birthday=gte.${encodeURIComponent(start)}` +
      `&birthday=lt.${encodeURIComponent(end)}` +
      `&order=birthday.asc` +
      `&limit=1000`;

    const rows = await sbFetch(query);
    return attachZooInfo(rows);
  }

  /**
   * 週末（今週の土〜日）の誕生日を取得。無ければ今日以降の直近2件。
   */
  async function loadWeekendOrSoonest(){
    const now = new Date();
    const day = now.getDay(); // 0=日
    const sat = new Date(now); sat.setDate(now.getDate() + ((6 - day + 7) % 7));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);

    const satStr = ymd(stripTime(sat));
    const sunNext = new Date(sun); sunNext.setDate(sunNext.getDate() + 1); // exclusive
    const sunNextStr = ymd(stripTime(sunNext));

    const weekendQ = `/rest/v1/babies` +
      `?select=id,name,species,birthday,thumbnail_url,zoo_id` +
      `&birthday=gte.${encodeURIComponent(satStr)}` +
      `&birthday=lt.${encodeURIComponent(sunNextStr)}` +
      `&order=birthday.asc` +
      `&limit=10`;

    let rows = await sbFetch(weekendQ);
    if (!rows || rows.length === 0) {
      const todayStr = ymd(stripTime(now));
      const soonQ = `/rest/v1/babies` +
        `?select=id,name,species,birthday,thumbnail_url,zoo_id` +
        `&birthday=gte.${encodeURIComponent(todayStr)}` +
        `&order=birthday.asc` +
        `&limit=2`;
      rows = await sbFetch(soonQ);
    }
    return attachZooInfo(rows || []);
  }

  /* =========================
   * 初期化
   * ========================= */
  document.addEventListener('DOMContentLoaded', async () => {
    setActiveTabbarLink();
    headerOnScrollCompact();
    improveExternalUseHref();
    a11yTouchFocus();
    reduceMotionGuard();
    autoSetTabbarTitles();

    // Home-only widgets
    await mountHeroWeekend();       // 週末 or 直近
    await mountCalendar(new Date()); // 今月
    bindMonthNav();
    bindLike();
  });

  /* =========================
   * ナビ／A11y関連
   * ========================= */

  function normalizePath(inputHref) {
    try {
      const abs = new URL(inputHref, location.href);
      let p = abs.pathname;
      p = p.replace(/\/{2,}/g, '/');
      if (p.endsWith('/')) p += 'index.html';
      return p;
    } catch {
      let p = String(inputHref || '');
      p = p.replace(/\/{2,}/g, '/');
      if (/\/$/.test(p)) p += 'index.html';
      return p;
    }
  }

  function setActiveTabbarLink() {
    const current = normalizePath(location.pathname);
    const links = $$('.tabbar .tabbar__link');
    if (!links.length) return;
    links.forEach(a => {
      a.classList.remove('is-active');
      a.removeAttribute('aria-current');
    });
    let matched = null;
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const target = normalizePath(href);
      if (target === current) { matched = a; break; }
    }
    if (!matched) {
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (/(\.|\/)index\.html$/.test(href) && /\/index\.html$/.test(current)) { matched = a; break; }
      }
    }
    if (matched) {
      matched.classList.add('is-active');
      matched.setAttribute('aria-current', 'page');
    }
  }

  function headerOnScrollCompact() {
    const header = $('.site-header');
    if (!header) return;
    const onScroll = () => {
      const scrolled = window.scrollY > 6;
      header.classList.toggle('is-scrolled', scrolled);
      document.body.classList.toggle('header-scrolled', scrolled);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function a11yTouchFocus() {
    document.addEventListener(
      'touchstart',
      (e) => {
        const btn = e.target.closest('button, a, [tabindex]');
        if (!btn) return;
        btn.classList.add('had-touch');
      },
      { passive: true }
    );
  }

  function reduceMotionGuard() {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      document.documentElement.style.scrollBehavior = 'auto';
    }
  }

  function improveExternalUseHref() {
    $$('use').forEach((u) => {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (href) u.setAttribute('href', href);
    });
  }

  function autoSetTabbarTitles() {
    $$('.tabbar__link').forEach((link) => {
      const label = $('.tabbar__text', link);
      if (label && !link.title) link.title = label.textContent.trim();
    });
  }

  /* =========================
   * ヒーロー（今週末 or 直近）
   * ========================= */

  async function mountHeroWeekend(){
    const wrap = $('#hero-list'); if(!wrap) return;
    wrap.innerHTML = '';
    let items = [];
    try {
      items = await loadWeekendOrSoonest();
    } catch(e){
      console.error(e);
      wrap.insertAdjacentHTML('beforeend', `<p aria-live="polite">データの読み込みに失敗しました。</p>`);
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      wrap.insertAdjacentHTML('beforeend', `<p aria-live="polite">今週末・直近のお誕生日データが見つかりませんでした。</p>`);
      return;
    }

    items.slice(0,2).forEach(addHeroCard);
  }

  function addHeroCard(b){
    const today = stripTime(new Date());
    const bd = stripTime(new Date(b.birthday));
    const diff = Math.ceil((bd - today) / 86400000);
    const meta = diff===0 ? '今日お誕生日！' : (diff>0 ? `あと${diff}日` : 'お誕生日は過ぎました');
    const zooLabel = b.zoo?.name ? ` ｜ ${esc(b.zoo.name)}` : '';
    const el = document.createElement('div');
    el.className = 'hero-card';
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <div class="hero-card__avatar" aria-hidden="true">${pickEmoji(b)}</div>
      <div>
        <p class="hero-card__title">${esc(b.name)}（${esc(b.species)}）</p>
        <p class="hero-card__meta">誕生日 ${esc(b.birthday)}${zooLabel} ｜ ${meta}</p>
      </div>
      <button class="hero-card__cta" type="button" aria-label="${esc(b.name)}の詳細を見る">見る</button>
    `;
    $('#hero-list').appendChild(el);
  }

  /* =========================
   * カレンダー
   * ========================= */
  let currentMonth = new Date();

  async function mountCalendar(date){
    const grid = $('#cal-grid'); if(!grid) return;
    currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    grid.innerHTML = '';

    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth(); // 0-11

    // 当月分をAPIで読み込み（zoo情報を同時解決）
    let monthly = [];
    try{
      monthly = await loadBabiesByMonth(y, m+1);
    }catch(e){
      console.error(e);
      monthly = [];
    }

    // 週の開始インデックス・最終日
    const first = new Date(y,m,1);
    const startIdx = first.getDay();
    const lastDate = new Date(y, m + 1, 0).getDate();

    const today = stripTime(new Date());

    // 空白（前月分）
    for(let i=0;i<startIdx;i++){
      const d = document.createElement('div');
      d.className = 'cal-day cal-day--muted';
      d.setAttribute('aria-disabled','true');
      grid.appendChild(d);
    }

    // 今月
    for(let day=1; day<=lastDate; day++){
      const cellDate = new Date(y, m, day);
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      cell.setAttribute('role','gridcell');
      cell.innerHTML = `<span class="cal-day__date">${day}</span>`;

      // 誕生日がある日（当月データのみでOK）
      const hits = monthly.filter(b => {
        const d = new Date(b.birthday);
        return d.getFullYear()===y && d.getMonth()===m && d.getDate()===day;
      });

      if(hits.length){
        const dot = document.createElement('span');
        dot.className = 'cal-day__dot';
        if(stripTime(cellDate) < today) dot.classList.add('cal-day__dot--past');
        cell.appendChild(dot);
        cell.title = hits.map(h=>{
          const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
          return `${h.name}（${h.species}${zoo}）`;
        }).join(' / ');
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => openDay(hits, cellDate));
        cell.setAttribute('aria-label', `${y}年${m+1}月${day}日、${hits.length}件の誕生日`);
      }else{
        cell.setAttribute('aria-label', `${y}年${m+1}月${day}日`);
      }
      grid.appendChild(cell);
    }

    // タイトル更新
    const calTitle = $('#cal-title');
    if (calTitle) calTitle.textContent = `${y}年${m+1}月の誕生日カレンダー`;

    // 当月に該当が無い場合の案内
    const old = document.getElementById('cal-empty-note');
    if (old) old.remove();
    if (monthly.length === 0){
      const p = document.createElement('p');
      p.id = 'cal-empty-note';
      p.style.color = '#7a6d72';
      p.style.fontSize = '13px';
      p.textContent = 'この月のお誕生日は登録がありません。';
      grid.parentNode.appendChild(p);
    }
  }

  function openDay(hits, dateObj){
    const yyyy = dateObj.getFullYear(), mm = dateObj.getMonth()+1, dd = dateObj.getDate();
    const list = hits.map(h=>{
      const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
      return `・${h.name}（${h.species}${zoo}）`;
    }).join('\n');
    alert(`${yyyy}年${mm}月${dd}日の誕生日\n\n${list}`);
  }

  function bindMonthNav(){
    const prev = $('#prev-month'), next = $('#next-month');
    if(prev) prev.addEventListener('click', async ()=> {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1);
      await mountCalendar(d);
    });
    if(next) next.addEventListener('click', async ()=> {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1);
      await mountCalendar(d);
    });
  }

  /* =========================
   * お気に入り（トップ保存）
   * ========================= */
  function bindLike(){
    const btn = document.querySelector('.like-btn');
    if (!btn) return;
    const KEY = 'zb_top_fav';
    const set = (on)=>{
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'お気に入りに登録済み' : 'お気に入りに登録';
    };
    set(localStorage.getItem(KEY)==='1');
    btn.addEventListener('click', ()=>{
      const on = !(localStorage.getItem(KEY)==='1');
      localStorage.setItem(KEY, on ? '1':'0');
      set(on);
      btn.animate(
        [{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],
        {duration:240,easing:'ease-out'}
      );
    }, {passive:false});
  }

  /* =========================
   * 表示補助（emoji選定/エスケープ）
   * ========================= */
  function pickEmoji(baby){
    const m = (baby.species || '').toLowerCase();
    if (m.includes('パンダ') || m.includes('panda')) return '🐼';
    if (m.includes('カバ')   || m.includes('hippo')) return '🦛';
    if (m.includes('ペンギン')|| m.includes('peng')) return '🐧';
    if (m.includes('トラ')   || m.includes('tiger')) return '🐯';
    if (m.includes('ライオン')|| m.includes('lion'))  return '🦁';
    if (m.includes('キリン') || m.includes('giraffe'))return '🦒';
    if (m.includes('シロクマ')|| m.includes('ホッキョクグマ')|| m.includes('polar')) return '🐻‍❄️';
    if (m.includes('レッサーパンダ')|| m.includes('red panda')) return '🦊';
    if (m.includes('コアラ')|| m.includes('koala')) return '🐨';
    if (m.includes('オカピ')|| m.includes('okapi')) return '🦓';
    return '🐾';
  }

  function esc(s){
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  /* =========================
   *（任意）月移動の下限/上限をつけたい場合
   * =========================
  // const MIN_MONTH = new Date(2023, 0, 1);   // 2023-01
  // const MAX_MONTH = new Date(2026, 11, 1);  // 2026-12
  // function sameYM(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth(); }
  // function clampToYM(d){
  //   const x = new Date(d.getFullYear(), d.getMonth(), 1);
  //   if (x < MIN_MONTH) return new Date(MIN_MONTH);
  //   if (x > MAX_MONTH) return new Date(MAX_MONTH);
  //   return x;
  // }
  */

})();
