// assets/js/app.js
// Supabase連携版：ヒーロー/カレンダーともに「表示中の年・月に誕生日を迎える 0〜3歳」を表示
// - TOPヒーロー：bday-card（カレンダー下部リストと完全共通UI）で今月0〜3歳を表示
// - カレンダー：0〜3歳の年齢バッジ（日付セル）＋ 当月リストは共有レンダラーで描画
// - zoo_id を用いて /zoos から name を取得（メモリキャッシュ）
// - ヘッダー：検索/お知らせの軽い連携、likeボタンはローカルストレージ（UIのみ）

(() => {
  /* =========================
   * 基本ユーティリティ
   * ========================= */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const stripTime = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /* =========================
   * Supabase REST 設定
   * ========================= */
  const SUPABASE_URL = "https://hvhpfrksyytthupboaeo.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY";

  async function sbFetch(path){
    const url = `${SUPABASE_URL}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "count=none"
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> "");
      throw new Error(`Supabase fetch failed (${res.status}): ${text || url}`);
    }
    return res.json();
  }

  /* =========================
   * babies / zoos 取得
   * ========================= */
  const zooCache = new Map();           // zoo_id -> zoo
  const monthCache = new Map();         // `${Y}-${M}` -> items（0〜3歳）

  async function ensureZoos(ids){
    const need = ids.filter(id => id && !zooCache.has(id));
    if (!need.length) return;
    const inList = `(${need.map(encodeURIComponent).join(",")})`;
    const path = `/rest/v1/zoos?select=id,name,prefecture,city,website&id=in.${encodeURIComponent(inList)}`;
    const rows = await sbFetch(path);
    rows.forEach(z => zooCache.set(z.id, z));
    need.forEach(id => { if (!zooCache.has(id)) zooCache.set(id, null); });
  }

  async function attachZooInfo(babies){
    const ids = Array.from(new Set(babies.map(b => b.zoo_id).filter(Boolean)));
    await ensureZoos(ids);
    return babies.map(b => ({ ...b, zoo: b.zoo_id ? (zooCache.get(b.zoo_id) || null) : null }));
  }

  // 指定の年Y・月Mに“誕生日を迎える”0〜3歳を取得（Y-3..Y の同月をORで取得）
  async function loadMonthAges0to3(Y, M_1to12){
    const key = `${Y}-${M_1to12}`;
    if (monthCache.has(key)) return monthCache.get(key);

    const ranges = [];
    for (let dy = 3; dy >= 0; dy--) {
      const year = Y - dy;
      const start = `${year}-${pad2(M_1to12)}-01`;
      const nextMonthDate = new Date(year, M_1to12, 1); // 翌月1日
      const end   = `${nextMonthDate.getFullYear()}-${pad2(nextMonthDate.getMonth()+1)}-01`;
      ranges.push(`and(birthday.gte.${start},birthday.lt.${end})`);
    }
    const orParam = `(${ranges.join(",")})`;
    const base = `/rest/v1/babies?select=id,name,species,birthday,zoo_id,thumbnail_url&or=${encodeURIComponent(orParam)}&order=birthday.asc&limit=2000`;
    const rows = await sbFetch(base);
    const withZoo = await attachZooInfo(rows);

    const enriched = withZoo.map(b => {
      const bd = new Date(b.birthday);
      return { ...b, age: Y - bd.getFullYear(), day: bd.getDate(), month: bd.getMonth()+1 };
    }).filter(b => b.age >= 0 && b.age <= 3)
      .sort((a,b) => a.day - b.day || (a.name || '').localeCompare(b.name || '', 'ja'));

    monthCache.set(key, enriched);
    return enriched;
  }

  /* =========================
   * DOM 初期化
   * ========================= */
  document.addEventListener('DOMContentLoaded', async () => {
    setActiveTabbarLink();
    headerOnScrollCompact();
    improveExternalUseHref();
    a11yTouchFocus();
    reduceMotionGuard();
    autoSetTabbarTitles();

    // TOPヒーロー（今月 0〜3歳）※存在時のみ
    await mountHeroThisMonth();

    // カレンダー（今月）※存在時のみ
    await mountCalendar(new Date());

    bindMonthNav();    // カレンダーの月移動（存在時のみ）
    bindLike();
    bindHeaderActions();
  });

  /* =========================
   * 共通レンダラー：bday-card
   * ========================= */
  function renderMonthlyCards(listEl, items){
    listEl.innerHTML = '';
    if (!items?.length){
      listEl.insertAdjacentHTML('beforeend',
        `<p style="color:#6b6b6b;font-size:13px;margin:0">今月のお誕生日（0〜3歳）の登録がありません。</p>`);
      return;
    }
    items.forEach(b => {
      const ageText = b.age === 0 ? '今年で0歳（はじめての誕生日）' : `今年で${b.age}歳`;
      const zooLabel = b.zoo?.name ? ` ｜ ${esc(b.zoo.name)}` : '';
      const card = document.createElement('div');
      card.className = 'bday-card';
      card.setAttribute('role','listitem');
      card.innerHTML = `
        <div class="bday-card__avatar" aria-hidden="true">${pickEmoji(b)}</div>
        <div>
          <p class="bday-card__title">${esc(b.name)}（${esc(b.species)}）</p>
          <p class="bday-card__meta">誕生日 ${esc(b.birthday)}${zooLabel}</p>
        </div>
        <span class="bday-chip">${b.age}歳</span>
      `;
      listEl.appendChild(card);
    });
  }

  /* =========================
   * ナビ／A11y
   * ========================= */
  function normalizePath(inputHref) {
    try {
      const abs = new URL(inputHref, location.href);
      let p = abs.pathname.replace(/\/{2,}/g,'/');
      if (p.endsWith('/')) p += 'index.html';
      return p;
    } catch {
      let p = String(inputHref || '').replace(/\/{2,}/g,'/');
      if (/\/$/.test(p)) p += 'index.html';
      return p;
    }
  }

  function setActiveTabbarLink() {
    const current = normalizePath(location.pathname);
    const links = $$('.tabbar .tabbar__link');
    if (!links.length) return;
    links.forEach(a => { a.classList.remove('is-active'); a.removeAttribute('aria-current'); });
    let matched = null;
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      if (normalizePath(href) === current) { matched = a; break; }
    }
    if (!matched) {
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (/(\.|\/)index\.html$/.test(href) && /\/index\.html$/.test(current)) { matched = a; break; }
      }
    }
    if (matched) { matched.classList.add('is-active'); matched.setAttribute('aria-current','page'); }
  }

  function headerOnScrollCompact() {
    const header = $('.site-header'); if (!header) return;
    const onScroll = () => {
      const scrolled = window.scrollY > 6;
      header.classList.toggle('is-scrolled', scrolled);
      document.body.classList.toggle('header-scrolled', scrolled);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function a11yTouchFocus() {
    document.addEventListener('touchstart', (e) => {
      const btn = e.target.closest('button, a, [tabindex]');
      if (btn) btn.classList.add('had-touch');
    }, { passive: true });
  }

  function reduceMotionGuard() {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) document.documentElement.style.scrollBehavior = 'auto';
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
   * TOPヒーロー（今月 0〜3歳）※共通レンダラーを使用
   * ========================= */
  async function mountHeroThisMonth(){
    const listEl = $('#home-monthly-list'); if (!listEl) return; // TOP以外はスキップ

    // 見出しの整合
    const now = new Date();
    const Y = now.getFullYear(); const M = now.getMonth() + 1;
    const heroTitle = $('#hero-title'); if (heroTitle) heroTitle.textContent = '今月お誕生日の赤ちゃん（0〜3歳）';
    const heroMonth = $('#hero-month-label'); if (heroMonth) heroMonth.textContent = `${Y}年${M}月 の誕生日`;

    // データ取得（0〜3歳・今月）
    let items = [];
    try { items = await loadMonthAges0to3(Y, M); }
    catch(e){ console.error(e); }

    // 共通レンダラーで描画
    renderMonthlyCards(listEl, items);

    // CTA：当月へ
    const toCal = $('#to-calendar');
    if (toCal) toCal.href = `./calendar/index.html?y=${Y}&m=${pad2(M)}`;
  }

  /* =========================
   * カレンダー（年齢バッジ & 当月リスト=共有レンダラー）
   * ========================= */
  let currentMonth = new Date();

  async function mountCalendar(date){
    const grid = $('#cal-grid'); if (!grid) return; // TOP等にcal-gridなければスキップ

    currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    grid.innerHTML = '';

    const Y = currentMonth.getFullYear();
    const M = currentMonth.getMonth() + 1;

    let monthly = [];
    try { monthly = await loadMonthAges0to3(Y, M); }
    catch(e){ console.error(e); monthly = []; }

    // タイトル更新
    const calTitle = $('#cal-title');
    if (calTitle) calTitle.textContent = `${Y}年${M}月の誕生日カレンダー`;

    // 曜日先頭インデックス・最終日
    const first = new Date(Y, M-1, 1);
    const startIdx = first.getDay();
    const lastDate = new Date(Y, M, 0).getDate();
    const today = stripTime(new Date());

    // 前月プレースホルダ
    for(let i=0;i<startIdx;i++){
      const d = document.createElement('div');
      d.className = 'cal-day cal-day--muted';
      d.setAttribute('aria-disabled','true');
      grid.appendChild(d);
    }

    // 当月セル
    for(let day=1; day<=lastDate; day++){
      const cellDate = new Date(Y, M-1, day);
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      cell.setAttribute('role','gridcell');
      cell.innerHTML = `<span class="cal-day__date">${day}</span>`;

      const hits = monthly.filter(b => b.day === day);
      if (hits.length){
        const badgeWrap = document.createElement('div');
        badgeWrap.className = 'badge-wrap';
        // 過去日はグレー
        const isPast = stripTime(cellDate) < today;
        hits.slice(0,2).forEach(h => badgeWrap.appendChild(makeAgeBadge(h.age, isPast)));
        if (hits.length > 2){
          const more = document.createElement('span');
          more.textContent = `+${hits.length - 2}`;
          more.style.fontSize = '11px';
          more.style.color = '#6b6b6b';
          badgeWrap.appendChild(more);
        }
        cell.appendChild(badgeWrap);

        // a11yとツールチップ
        const ariaAges = hits.map(h=>`${h.age}歳`).join(', ');
        cell.title = hits.map(h=>{
          const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
          return `${h.name}（${h.species}${zoo}）: ${h.age}歳`;
        }).join(' / ');
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => openDay(hits, cellDate, Y, M, day));
        cell.setAttribute('aria-label', `${Y}年${M}月${day}日、${hits.length}件の誕生日（${ariaAges}）`);
      } else {
        cell.setAttribute('aria-label', `${Y}年${M}月${day}日`);
      }

      grid.appendChild(cell);
    }

    // 月別リスト（共有レンダラー）
    renderMonthlyList(Y, M, monthly);
  }

  function makeAgeBadge(age, past){
    const b = document.createElement('span');
    b.textContent = String(age);
    b.className = 'age-badge' + (past ? ' age-badge--past' : '');
    return b;
  }

  function openDay(hits, dateObj, Y, M, D){
    const list = hits.map(h=>{
      const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
      return `・${h.name}（${h.species}${zoo}）：${h.age}歳`;
    }).join('\n');
    alert(`${Y}年${M}月${D}日の誕生日（0〜3歳）\n\n${list}`);
  }

  // 薄いラッパ：カレンダーの月別リスト（UIは共有レンダラー）
  function renderMonthlyList(Y, M, items){
    const wrap = $('#js-birthdayList');
    if (!wrap) return;
    const monthLabelEl = $('#month-label-list');
    if (monthLabelEl) monthLabelEl.textContent = `${Y}年${M}月`;
    renderMonthlyCards(wrap, items);
  }

  function bindMonthNav(){
    const prev = $('#prev-month'), next = $('#next-month'), todayBtn = $('#today-month');
    if(prev) prev.addEventListener('click', async ()=> {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1);
      await mountCalendar(d);
    });
    if(next) next.addEventListener('click', async ()=> {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1);
      await mountCalendar(d);
    });
    if(todayBtn) todayBtn.addEventListener('click', async ()=> {
      const now = new Date();
      await mountCalendar(new Date(now.getFullYear(), now.getMonth(), 1));
    });

    // URLに ?y=YYYY&m=MM があれば、初期月をそちらへ（カレンダーページ想定）
    const grid = $('#cal-grid');
    if (grid) {
      const sp = new URLSearchParams(location.search);
      const y = Number(sp.get('y')), m = Number(sp.get('m'));
      if (y && m) mountCalendar(new Date(y, m - 1, 1));
    }
  }

  /* =========================
   * お気に入り（トップ保存）
   * ========================= */
  function bindLike(){
    const btn = $('.like-btn');
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
   * ヘッダー：検索/お知らせ
   * ========================= */
  function bindHeaderActions(){
    const bell = $('.bell-btn');
    if (bell) {
      bell.addEventListener('click', () => {
        const badge = bell.querySelector('.badge');
        if (badge) badge.remove();
      }, {passive:true});
    }
    const search = $('.search-btn');
    if (search) {
      search.addEventListener('click', () => {
        alert('検索は準備中です。');
      });
    }
  }

  /* =========================
   * 表示補助
   * ========================= */
  function pickEmoji(baby){
    const text = `${baby?.species || ''}`.toLowerCase();
    if (text.includes('レッサー') || text.includes('red')) return '🦊';
    if (text.includes('パンダ') || text.includes('panda')) return '🐼';
    if (text.includes('カバ')   || text.includes('hippo')) return '🦛';
    if (text.includes('ペンギン')|| text.includes('peng')) return '🐧';
    if (text.includes('トラ')   || text.includes('tiger')) return '🐯';
    if (text.includes('ライオン')|| text.includes('lion'))  return '🦁';
    if (text.includes('キリン') || text.includes('giraffe'))return '🦒';
    if (text.includes('シロクマ')|| text.includes('ホッキョクグマ')|| text.includes('polar')) return '🐻‍❄️';
    if (text.includes('コアラ') || text.includes('koala')) return '🐨';
    if (text.includes('オカピ') || text.includes('okapi')) return '🦓';    
    if (text.includes('ゾウ') || text.includes('elephant')) return '🐘';
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

})();
