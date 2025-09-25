// assets/js/app.js
// Supabase連携版：ヒーロー/カレンダーともに「表示中の年・月に誕生日を迎える 0〜3歳」を表示
// - ヒーロー：当月の0〜3歳（最大6件）※見出しを「今月お誕生日の赤ちゃん」に更新
// - カレンダー：当月の0〜3歳を日付セルに年齢バッジで表示（複数いる日は最大2つ＋“+N”）
// - zoo_id を用いて /zoos から name 等を取得し添付（メモリキャッシュ）
// - ヘッダー：検索/お知らせ（バッジ消去）の軽い連携、既存likeボタンはローカルストレージで保持
// 依存なし（バニラJS）

(() => {
  /* =========================
   * 基本ユーティリティ
   * ========================= */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const stripTime = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

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

  // zoo_id -> zoo のメモリキャッシュ
  const zooCache = new Map();

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

  // 指定の年Y・月Mに“誕生日を迎える”0〜3歳を取得
  // → (Y-3..Y)年の同月（M）を OR で束ねて取得 → age=Y - birthYear を算出 → 0..3 に限定
  async function loadMonthAges0to3(Y, M_1to12){
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

    // 当年Yでの年齢を付与し、0..3 のみ返す
    const enriched = withZoo.map(b => {
      const bd = new Date(b.birthday);
      const age = Y - bd.getFullYear();
      return { ...b, age };
    }).filter(b => b.age >= 0 && b.age <= 3);

    // 同日が混在しても扱えるよう、日付で安定ソート
    enriched.sort((a,b) => new Date(a.birthday) - new Date(b.birthday));
    return enriched;
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

    // ヒーロー：今月0〜3歳
    await mountHeroThisMonth();

    // カレンダー（今月）：0〜3歳の年齢バッジ
    await mountCalendar(new Date());

    bindMonthNav();
    bindLike();
    bindHeaderActions();
  });

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
   * ヒーロー（今月 0〜3歳）
   * ========================= */
  async function mountHeroThisMonth(){
    const wrap = $('#hero-list'); if (!wrap) return;
    wrap.innerHTML = '';

    // 見出しを更新（存在する場合）
    const heroTitle = $('#hero-title');
    if (heroTitle) heroTitle.textContent = '今月お誕生日の赤ちゃん';
    const heroDesc = document.querySelector('.hero__head .panel-desc');
    if (heroDesc) heroDesc.textContent = '0〜3歳までの赤ちゃんを表示します';

    const now = new Date();
    const Y = now.getFullYear();
    const M = now.getMonth() + 1;

    let items = [];
    try {
      items = await loadMonthAges0to3(Y, M);
    } catch(e){
      console.error(e);
      wrap.insertAdjacentHTML('beforeend', `<p aria-live="polite">データの読み込みに失敗しました。</p>`);
      return;
    }

    if (!items.length){
      wrap.insertAdjacentHTML('beforeend', `<p aria-live="polite">今月お誕生日の登録がありません。</p>`);
      return;
    }

    items.slice(0,6).forEach(addHeroCard);
  }

  function addHeroCard(b){
    const ageText = b.age === 0 ? '今年で0歳（はじめての誕生日）' : `今年で${b.age}歳`;
    const zooLabel = b.zoo?.name ? ` ｜ ${esc(b.zoo.name)}` : '';
    const el = document.createElement('div');
    el.className = 'hero-card';
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <div class="hero-card__avatar" aria-hidden="true">${pickEmoji(b)}</div>
      <div>
        <p class="hero-card__title">${esc(b.name)}（${esc(b.species)}）</p>
        <p class="hero-card__meta">誕生日 ${esc(b.birthday)}${zooLabel} ｜ ${ageText}</p>
      </div>
      <button class="hero-card__cta" type="button" aria-label="${esc(b.name)}の詳細を見る">見る</button>
    `;
    $('#hero-list').appendChild(el);
  }

  /* =========================
   * カレンダー（0〜3歳の年齢バッジ）
   * ========================= */
  let currentMonth = new Date();

  async function mountCalendar(date){
    const grid = $('#cal-grid'); if (!grid) return;
    currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    grid.innerHTML = '';

    const Y = currentMonth.getFullYear();
    const M = currentMonth.getMonth() + 1;

    // 当年Yの当月Mに“誕生日を迎える” 0..3歳を取得
    let monthly = [];
    try{
      monthly = await loadMonthAges0to3(Y, M);
    }catch(e){
      console.error(e);
      monthly = [];
    }

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

      // 当月のその日に誕生日を迎える 0..3歳
      const hits = monthly.filter(b => {
        const d = new Date(b.birthday);
        return d.getMonth() === (M-1) && d.getDate() === day;
      });

      if (hits.length){
        // 年齢バッジ（最大2つ＋+N）
        const badgeWrap = document.createElement('div');
        badgeWrap.style.position = 'absolute';
        badgeWrap.style.bottom = '6px';
        badgeWrap.style.left = '50%';
        badgeWrap.style.transform = 'translateX(-50%)';
        badgeWrap.style.display = 'flex';
        badgeWrap.style.gap = '4px';
        badgeWrap.setAttribute('aria-hidden','true');

        const makeBadge = (age, past) => {
          const b = document.createElement('span');
          b.textContent = String(age);
          b.style.display = 'inline-grid';
          b.style.placeItems = 'center';
          b.style.width = '16px';
          b.style.height = '16px';
          b.style.borderRadius = '999px';
          b.style.fontSize = '11px';
          b.style.fontWeight = '900';
          b.style.lineHeight = '1';
          b.style.background = past ? '#96a0ad' : 'var(--pink-400)';
          b.style.color = '#fff';
          b.style.boxShadow = '0 1px 0 rgba(0,0,0,.08)';
          return b;
        };

        const isPast = stripTime(cellDate) < today;
        const show = hits.slice(0,2);
        show.forEach(h => badgeWrap.appendChild(makeBadge(h.age, isPast)));
        if (hits.length > 2){
          const more = document.createElement('span');
          more.textContent = `+${hits.length - 2}`;
          more.style.fontSize = '11px';
          more.style.color = '#6b6b6b';
          badgeWrap.appendChild(more);
        }
        cell.appendChild(badgeWrap);

        // アクセシビリティ・ツールチップ用
        const ariaAges = hits.map(h=>`${h.age}歳`).join(', ');
        cell.title = hits.map(h=>{
          const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
          return `${h.name}（${h.species}${zoo}）: ${h.age}歳`;
        }).join(' / ');
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => openDay(hits, cellDate, Y, M, day));
        cell.setAttribute('aria-label', `${Y}年${M}月${day}日、${hits.length}件の誕生日（${ariaAges}）`);
      }else{
        cell.setAttribute('aria-label', `${Y}年${M}月${day}日`);
      }

      grid.appendChild(cell);
    }

    // 当月に該当が無い場合の案内
    const old = document.getElementById('cal-empty-note');
    if (old) old.remove();
    if (monthly.length === 0){
      const p = document.createElement('p');
      p.id = 'cal-empty-note';
      p.style.color = '#7a6d72';
      p.style.fontSize = '13px';
      p.textContent = 'この月のお誕生日は登録がありません（0〜3歳）。';
      grid.parentNode.appendChild(p);
    }
  }

  function openDay(hits, dateObj, Y, M, D){
    const list = hits.map(h=>{
      const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
      const ageText = `${h.age}歳`;
      return `・${h.name}（${h.species}${zoo}）${ageText}`;
    }).join('\n');
    alert(`${Y}年${M}月${D}日の誕生日（0〜3歳）\n\n${list}`);
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
   * ヘッダー：検索/お知らせ
   * ========================= */
  function bindHeaderActions(){
    // お知らせ：クリックでバッジ消去（簡易）
    const bell = document.querySelector('.bell-btn');
    if (bell) {
      bell.addEventListener('click', () => {
        const badge = bell.querySelector('.badge');
        if (badge) badge.remove();
      }, {passive:true});
    }
    // 検索：現状プレースホルダ
    const search = document.querySelector('.search-btn');
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

})();
