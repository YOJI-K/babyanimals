// assets/js/app.js
// ヒーロー/カレンダー：表示中の年・月に誕生日を迎える 0〜3歳を表示
// - TOPヒーロー：bday-card（カレンダー下部リストと共通UI）で今月0〜3歳
// - カレンダー：0〜3歳の年齢バッジ（日付セル）＋ 当月リスト（共通レンダラー）
// - zoo_id -> /zoos の name を付与（メモリキャッシュ）

(() => {
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const stripTime = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const esc = (s)=> String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');

  /* ===== Supabase REST ===== */
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

  /* ===== 取得 & キャッシュ ===== */
  const zooCache = new Map();    // zoo_id -> zoo
  const monthCache = new Map();  // `${Y}-${M}` -> items

  async function ensureZoos(ids){
    const need = ids.filter(id => id && !zooCache.has(id));
    if (!need.length) return;
    // in.(uuid1,uuid2,...) を1回だけエンコード（ダブルエンコード回避）
    const inList = `(${need.join(",")})`;
    const path = `/rest/v1/zoos?select=id,name,prefecture,city,website&id=in.${encodeURIComponent(inList)}`;
    const rows = await sbFetch(path);
    rows.forEach(z => zooCache.set(z.id, z));
    // 万一取得できないIDもnullで埋める
    need.forEach(id => { if (!zooCache.has(id)) zooCache.set(id, null); });
  }

  async function attachZooInfo(babies){
    const ids = Array.from(new Set(babies.map(b => b.zoo_id).filter(Boolean)));
    try { await ensureZoos(ids); } catch(e){ console.error(e); }
    return babies.map(b => ({ ...b, zoo: b.zoo_id ? (zooCache.get(b.zoo_id) || null) : null }));
  }

  async function loadMonthAges0to3(Y, M_1to12){
    const key = `${Y}-${M_1to12}`;
    if (monthCache.has(key)) return monthCache.get(key);

    const ranges = [];
    for (let dy = 3; dy >= 0; dy--) {
      const y = Y - dy;
      const start = `${y}-${pad2(M_1to12)}-01`;
      const endDate = new Date(y, M_1to12, 1); // 翌月1日
      const end   = `${endDate.getFullYear()}-${pad2(endDate.getMonth()+1)}-01`;
      ranges.push(`and(birthday.gte.${start},birthday.lt.${end})`);
    }
    const orParam = `(${ranges.join(",")})`;

    let rows = [];
    try{
      rows = await sbFetch(`/rest/v1/babies?select=id,name,species,birthday,zoo_id,thumbnail_url&or=${encodeURIComponent(orParam)}&order=birthday.asc&limit=2000`);
    }catch(e){
      console.error(e);
      rows = []; // 失敗時は空でフォールバックUIを出す
    }

    let withZoo = rows;
    try { withZoo = await attachZooInfo(rows); } catch(e){ console.error(e); }

    const enriched = withZoo.map(b => {
      const bd = new Date(b.birthday);
      return { ...b, age: Y - bd.getFullYear(), day: bd.getDate(), month: bd.getMonth()+1 };
    }).filter(b => b.age >= 0 && b.age <= 3)
      .sort((a,b) => a.day - b.day || (a.name || '').localeCompare(b.name || '', 'ja'));

    monthCache.set(key, enriched);
    return enriched;
  }

  /* ===== 共通レンダラー：bday-card ===== */
function pickEmoji(baby){
  const s = String(baby?.species || "").toLowerCase();

  // 追加・変更はこの表に「先に判定したいものほど上へ」入れていけばOK
  const MAP = [
    // --- パンダ系（レッサーを先に） ---
    ['🦊', ['レッサーパンダ','lesser panda','red panda']], // レッサーは代替として🦊
    ['🐼', ['ジャイアントパンダ','panda','パンダ']],

    // --- クマ ---
    ['🐻‍❄️', ['ホッキョクグマ','polar bear','polar']],
    ['🐻',   ['ヒグマ','ツキノワグマ','くま','熊','bear']],

    // --- ネコ科（大型） ---
    ['🐯', ['ホワイトタイガー','white tiger','アムールトラ','トラ','タイガー','tiger']],
    ['🦁', ['ライオン','lion']],
    ['🐆', ['ヒョウ','レオパード','leopard','ジャガー','jaguar','ユキヒョウ','snow leopard','snowleopard']],

    // --- イヌ科など ---
    ['🐺', ['オオカミ','wolf']],
    ['🦊', ['キツネ','fox']],

    // --- 有蹄類（ウマ目・ウシ目など） ---
    ['🦒', ['キリン','giraffe']],
    ['🐘', ['ゾウ','象','asian elephant','asian-elephant','elephant','アジアゾウ','アフリカゾウ']], // ※半角セミコロン必須
    ['🦏', ['サイ','インドサイ','rhinoceros','rhino']],
    ['🦛', ['カバ','hippo','hippopotamus']],
    ['🦓', ['シマウマ','zebra','オカピ','okapi']], // 便宜上🦓で表現
    ['🦬', ['バイソン','bison','アメリカバイソン']],
    ['🦌', ['シカ','鹿','deer','エランド','eland']],
    ['🐴', ['ウマ','馬','horse','ポニー','pony']],
    ['🐫', ['ラクダ','camel']],
    ['🦙', ['ラマ','llama','アルパカ','alpaca']],

    // --- げっ歯類・小型哺乳類 ---
    ['🦫', ['ビーバー','beaver']],
    ['🐿️', ['リス','squirrel','プレーリードッグ','prairie dog']],
    ['🦔', ['ハリネズミ','hedgehog']],
    ['🦨', ['スカンク','skunk']],
    ['🐹', ['ハムスター','hamster']],
    ['🦝', ['アライグマ','raccoon']],

    // --- 食肉目（イタチ科など） ---
    ['🦦', ['カワウソ','otter','ラッコ','sea otter','sea-otter']],

    // --- 霊長類 ---
    ['🦍', ['ゴリラ','gorilla']],
    ['🦧', ['オランウータン','orangutan']],
    ['🐒', ['サル','猿','monkey','テナガザル','gibbon','ヒヒ','baboon','マンドリル','mandrill','ニホンザル','macaque','チンパンジー','chimpanzee']],

    // --- 鳥類 ---
    ['🐧', ['ペンギン','penguin','humboldt']],
    ['🦩', ['フラミンゴ','flamingo']],
    ['🦉', ['フクロウ','owl']],
    ['🦅', ['ワシ','eagle']],
    ['🦜', ['オウム','インコ','parrot','macaw','cockatoo']],
    ['🦚', ['クジャク','peacock']],
    ['🦆', ['カモ','duck']],
    ['🦢', ['ハクチョウ','白鳥','swan']],

    // --- 爬虫類・両生類 ---
    ['🐊', ['ワニ','crocodile','alligator','gator']],
    ['🐢', ['カメ','turtle','tortoise']],
    ['🐍', ['ヘビ','蛇','snake','python','boa']],
    ['🦎', ['トカゲ','lizard','gecko','chameleon','アオジタ','スキンク']],
    ['🐸', ['カエル','frog']],

    // --- 海棲哺乳類 ---
    ['🦭', ['アシカ','アザラシ','seal','sea lion','sealion','walrus','セイウチ']],
    ['🐬', ['イルカ','dolphin']],
    ['🐋', ['クジラ','whale']],

    // --- その他 ---
    ['🦥', ['ナマケモノ','sloth']],
    // 明示指定（ミーアキャットは専用絵文字が無いので足跡で）
    ['🐾', ['ミーアキャット','meerkat']],
  ];

  // 判定
  for (const [emoji, keys] of MAP) {
    for (const k of keys) {
      const key = String(k).toLowerCase();
      if (s.includes(key)) return emoji;
    }
  }

  // フォールバック
  return '🐾';
}
  function renderMonthlyCards(listEl, items){
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!items?.length){
      listEl.insertAdjacentHTML('beforeend',
        `<div class="empty-state"><p class="empty-state__desc">今月のお誕生日（0〜3歳）の登録がありません。</p></div>`);
      return;
    }
    for (const b of items){
      const zooName = b.zoo?.name || '';
      const row = document.createElement('a');
      row.className = 'cal-event';
      row.href = `/babies/${encodeURIComponent(b.id)}/`;
      row.setAttribute('role','listitem');
      row.innerHTML = `
        <div class="cal-event__bar" style="background:var(--cal-event-birth)"></div>
        <div>
          <div class="cal-event__type" style="color:var(--ac)">誕生日 · ${b.age}歳</div>
          <div class="cal-event__title">${esc(b.name)}（${esc(b.species)}）${b.age}歳のお誕生日</div>
          ${zooName ? `<div class="cal-event__zoo">📍 ${esc(zooName)}</div>` : ''}
        </div>
      `;
      listEl.appendChild(row);
    }
  }

  /* ===== 初期化 ===== */
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      setActiveTabbarLink();
      headerOnScrollCompact();
      improveExternalUseHref();
      a11yTouchFocus();
      reduceMotionGuard();
      autoSetTabbarTitles();

      // TOPヒーロー（存在時のみ）
      await mountHeroThisMonth();

      // カレンダー（存在時のみ）
      await mountCalendar(new Date());

      bindMonthNav();
      bindLike();
      bindHeaderActions();
    } catch (e) {
      console.error('Init failed:', e);
    }
  });

  /* ===== TOPヒーロー（今月 0〜3歳） ===== */
  async function mountHeroThisMonth(){
    const listEl = $('#home-monthly-list'); if (!listEl) return;
    const now = new Date();
    const Y = now.getFullYear(), M = now.getMonth()+1;

    const heroTitle = $('#hero-title'); if (heroTitle) heroTitle.textContent = '今月お誕生日の赤ちゃん（0〜3歳）';
    const heroMonth = $('#hero-month-label'); if (heroMonth) heroMonth.textContent = `${Y}年${M}月 の誕生日`;

    let items = [];
    try { items = await loadMonthAges0to3(Y, M); } catch(e){ console.error(e); }
    renderMonthlyCards(listEl, items);

    const toCal = $('#to-calendar');
    if (toCal) toCal.href = `./calendar/index.html?y=${Y}&m=${pad2(M)}`;
  }

  /* ===== カレンダー（年齢バッジ & 当月リスト） ===== */
  let currentMonth = new Date();

  async function mountCalendar(date){
    const grid = $('#cal-grid'); if (!grid) return;

    currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    grid.innerHTML = '';

    const Y = currentMonth.getFullYear();
    const M = currentMonth.getMonth() + 1;

    let monthly = [];
    try { monthly = await loadMonthAges0to3(Y, M); } catch(e){ console.error(e); monthly = []; }

    const calTitle = $('#cal-title');
    if (calTitle) calTitle.textContent = `${Y}年${M}月`;

    const first = new Date(Y, M-1, 1);
    const startIdx = first.getDay();
    const lastDate = new Date(Y, M, 0).getDate();
    const today = stripTime(new Date());
    const isToday = (d) => d.getFullYear()===today.getFullYear() && d.getMonth()===today.getMonth() && d.getDate()===today.getDate();

    // 前月の末尾（other-month）を埋める
    const prevMonthLast = new Date(Y, M-1, 0).getDate();
    for(let i=startIdx-1; i>=0; i--){
      const d = document.createElement('div');
      d.className = 'cal-day other-month';
      d.innerHTML = `<span class="cal-dn">${prevMonthLast - i}</span>`;
      d.setAttribute('aria-hidden','true');
      grid.appendChild(d);
    }

    for(let day=1; day<=lastDate; day++){
      const cellDate = new Date(Y, M-1, day);
      const dow = cellDate.getDay(); // 0=日,6=土
      const cell = document.createElement('div');
      let cls = 'cal-day';
      if (dow === 0) cls += ' sun';
      if (dow === 6) cls += ' sat';
      if (isToday(cellDate)) cls += ' today';
      cell.className = cls;
      cell.setAttribute('role','gridcell');
      cell.innerHTML = `<span class="cal-dn">${day}</span><div class="cal-dots"></div>`;

      const hits = monthly.filter(b => b.day === day);
      if (hits.length){
        const dots = cell.querySelector('.cal-dots');
        hits.slice(0, 3).forEach(() => {
          const dot = document.createElement('span');
          dot.className = 'cal-dot cal-dot--birth';
          dots.appendChild(dot);
        });

        const ariaAges = hits.map(h=>`${h.age}歳`).join(', ');
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => openDay(hits, cellDate, Y, M, day));
        cell.setAttribute('aria-label', `${Y}年${M}月${day}日、${hits.length}件の誕生日（${ariaAges}）`);
      } else {
        cell.setAttribute('aria-label', `${Y}年${M}月${day}日`);
      }
      grid.appendChild(cell);
    }

    // 翌月の頭（other-month）で6行を埋める
    const totalCells = startIdx + lastDate;
    const trailing = (7 - (totalCells % 7)) % 7;
    for(let i=1; i<=trailing; i++){
      const d = document.createElement('div');
      d.className = 'cal-day other-month';
      d.innerHTML = `<span class="cal-dn">${i}</span>`;
      d.setAttribute('aria-hidden','true');
      grid.appendChild(d);
    }

    renderMonthlyList(Y, M, monthly);
  }

  function openDay(hits, dateObj, Y, M, D){
    const list = hits.map(h=>{
      const zoo = h.zoo?.name ? ` / ${h.zoo.name}` : '';
      return `・${h.name}（${h.species}${zoo}）：${h.age}歳`;
    }).join('\n');
    alert(`${Y}年${M}月${D}日の誕生日（0〜3歳）\n\n${list}`);
  }

  function renderMonthlyList(Y, M, items){
    const wrap = $('#js-birthdayList'); if (!wrap) return;
    const monthLabelEl = $('#month-label-list'); if (monthLabelEl) monthLabelEl.textContent = `${Y}年${M}月`;
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

    // ?y=YYYY&m=MM があればその月へ（カレンダーページ想定）
    const grid = $('#cal-grid');
    if (grid) {
      const sp = new URLSearchParams(location.search);
      const y = Number(sp.get('y')), m = Number(sp.get('m'));
      if (y && m) mountCalendar(new Date(y, m - 1, 1));
    }
  }

  /* ===== ナビ/ヘッダー小物 ===== */
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

  function bindLike(){
    const btn = $('.like-btn'); if (!btn) return;
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
      // GA4: お気に入り登録イベント（追加時のみ送信）
      if (on && typeof gtag === 'function') {
        gtag('event', 'favorite_add', { page_path: location.pathname });
      }
      btn.animate([{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],
        {duration:240,easing:'ease-out'});
    }, {passive:false});
  }

  function bindHeaderActions(){
    const bell = $('.bell-btn');
    if (bell) bell.addEventListener('click', () => {
      const badge = bell.querySelector('.badge'); if (badge) badge.remove();
    }, {passive:true});
    const search = $('.search-btn');
    if (search) search.addEventListener('click', () => { alert('検索は準備中です。'); });
  }

})();
/* ==========================================================
 * Home Hero v4 — 取得安定化（gte1本）/ SP=縦3件 / TB+=横6件
 * ========================================================== */
(() => {
  const $list  = document.getElementById('hero-list');
  if (!$list) return;

  const $skel  = document.getElementById('hero-skel');
  const $empty = document.getElementById('hero-empty');
  const $err   = document.getElementById('hero-error');
  const $label = document.getElementById('hero-month-label');
  const $prev  = document.getElementById('hero-prev');
  const $next  = document.getElementById('hero-next');
  const $jumpN = document.getElementById('hero-show-next');

  /* -------- Supabase env / fetch (fallback headers) -------- */
  // 環境取得（URLという名前を使わない）
function getSupabaseEnv(){
  const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
  const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
  const BASE_URL = (window.SUPABASE?.URL || window.SUPABASE?.SUPABASE_URL || metaUrl || 'https://hvhpfrksyytthupboaeo.supabase.co');
  const ANON     = (window.SUPABASE?.ANON || window.SUPABASE?.SUPABASE_ANON_KEY || metaKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY');
  return { BASE_URL, ANON };
}

// フェッチ（window.URL を明示）
async function fetchJSON(path){
  const { BASE_URL, ANON } = getSupabaseEnv();
  const u = new window.URL(path, BASE_URL);

  // まずは profile 付きで
  let res = await fetch(u.toString(), {
    headers:{ apikey:ANON, Authorization:`Bearer ${ANON}`, 'Accept-Profile':'public', 'Content-Profile':'public' },
    cache:'no-store'
  });

  // 406/4xx などはヘッダー簡素化で再試行
  if (!res.ok) {
    res = await fetch(u.toString(), { headers:{ apikey:ANON, Authorization:`Bearer ${ANON}` }, cache:'no-store' });
  }

  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} @ ${u.pathname} :: ${t}`);
  }
  return res.json();
}
  /* ---------------- Utils ---------------- */
  const ymd=(d)=>d.toISOString().slice(0,10);
  const startOfMonth=(d)=>new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth=(d)=>new Date(d.getFullYear(), d.getMonth()+1, 0);
  const addMonths=(d,n)=>new Date(d.getFullYear(), d.getMonth()+n, 1);
  const fmtMonthJP=(d)=>`${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月`;
  const fmtMD=(iso)=>{ const dd=new Date(iso); return dd.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'}); };
  function ageOn(bISO, ref){
    const b=new Date(bISO); if(isNaN(b)) return null;
    let a=ref.getFullYear()-b.getFullYear();
    const m=ref.getMonth()-b.getMonth();
    if(m<0 || (m===0 && ref.getDate()<b.getDate())) a--;
    return a;
  }
  const pickEmoji = (window.pickEmoji) || function(baby){
    const t = `${baby?.species||''}`.toLowerCase();
    if (t.includes('レッサー')||t.includes('red')) return '🦊';
    if (t.includes('パンダ') ||t.includes('panda')) return '🐼';
    if (t.includes('カバ')   ||t.includes('hippo')) return '🦛';
    if (t.includes('ペンギン')||t.includes('peng')) return '🐧';
    if (t.includes('トラ')   ||t.includes('tiger')||t.includes('タイガー')) return '🐯';
    if (t.includes('ライオン')||t.includes('lion'))  return '🦁';
    if (t.includes('キリン') ||t.includes('giraffe'))return '🦒';
    if (t.includes('シロクマ')||t.includes('ホッキョクグマ')||t.includes('polar')) return '🐻‍❄️';
    if (t.includes('コアラ') ||t.includes('koala')) return '🐨';
    if (t.includes('オカピ') ||t.includes('okapi')) return '🦓';
    if (t.includes('ゾウ')   ||t.includes('elephant')) return '🐘';
    if (t.includes('サイ')   ||t.includes('rhinoceros')) return '🦏';
    if (t.includes('カワウソ')||t.includes('otter')) return '🦦';
    if (t.includes('シカ')   ||t.includes('deer')) return '🦌';
    if (t.includes('イヌ')   ||t.includes('dog'))  return '🐶';
    if (t.includes('ネコ')   ||t.includes('cat'))  return '🐱';
    return '🐾';
  };

  /* -------- Data loader：birthday >= (対象月の3年前の1日) --------
     → 月一致/年齢0–3はクライアントで絞る（API差異に強い） */
  async function loadRangeSince(monthDate){
    const since = ymd(new Date(monthDate.getFullYear()-3, monthDate.getMonth(), 1));
    // 1) babies_public
    try {
      const qs = new URLSearchParams({
        select:'id,name,species,birthday,zoo_id,zoo_name,thumbnail_url',
        order:'birthday.asc.nullsfirst,id.asc', limit:'2000'
      });
      qs.append('birthday', `gte.${since}`);
      return await fetchJSON(`/rest/v1/babies_public?${qs.toString()}`);
    } catch(e1) {
      console.warn('[hero] babies_public failed -> babies(embed)', e1);
    }
    // 2) babies + embed
    try {
      const qs = new URLSearchParams({
        select:'id,name,species,birthday,zoo_id,thumbnail_url,zoo:zoos(name)',
        order:'birthday.asc.nullsfirst,id.asc', limit:'2000'
      });
      qs.append('birthday', `gte.${since}`);
      const raw = await fetchJSON(`/rest/v1/babies?${qs.toString()}`);
      return (raw||[]).map(x => ({...x, zoo_name:x.zoo?.name || ''}));
    } catch(e2) {
      console.warn('[hero] babies(embed) failed -> babies(plain)', e2);
    }
    // 3) babies 素
    const qs = new URLSearchParams({
      select:'id,name,species,birthday,zoo_id,thumbnail_url',
      order:'birthday.asc.nullsfirst,id.asc', limit:'2000'
    });
    qs.append('birthday', `gte.${since}`);
    const raw = await fetchJSON(`/rest/v1/babies?${qs.toString()}`);
    return (raw||[]).map(x => ({...x, zoo_name:''}));
  }

  /* ---------------- Render ---------------- */
  const isSP = () => window.matchMedia('(max-width: 599px)').matches;
  const heroLimit = () => isSP() ? 3 : 6;

  function cardHTML(x, ref){
    const a = ageOn(x.birthday, ref);
    const emoji = pickEmoji(x);
    const name = x.name || '（名前未設定）';
    const sp   = x.species || '不明';
    const date = x.birthday ? fmtMD(x.birthday) : '-';
    const zoo  = x.zoo_name || '園情報なし';
    const href = `/babies/${encodeURIComponent(x.id)}/`;
    const thumb = x.thumbnail_url
      ? `<img src="${x.thumbnail_url}" alt="${name}" loading="lazy" onerror="this.parentNode.classList.add('is-placeholder');this.remove();">`
      : emoji;
    const thumbCls = x.thumbnail_url ? 'dbb-bc__img' : 'dbb-bc__img is-placeholder';
    return `
      <a class="dbb-bc" role="listitem" href="${href}" aria-label="${name}（${sp}）">
        <div class="${thumbCls}">${thumb}${a!=null ? `<div class="dbb-bc__age">${a}歳</div>` : ''}</div>
        <div class="dbb-bc__body">
          <div class="dbb-bc__name">${name}</div>
          <div class="dbb-bc__species">${sp}</div>
          <div class="dbb-bc__zoo">📍 ${zoo}</div>
          <div class="dbb-bc__bday">🎂 ${date}</div>
        </div>
      </a>`;
  }
  function setState({skel=false, empty=false, err=false}={}){
    if($skel)  $skel.style.display = skel?'flex':'none';
    if($empty) $empty.hidden       = !empty;
    if($err)   $err.hidden         = !err;
    $list.style.display = (!skel && !empty && !err) ? '' : 'none';
  }

  let currentMonth = startOfMonth(new Date());

  async function renderMonth(d, attempt=0){
    try{
      setState({ skel:true });
      if ($label) $label.textContent = fmtMonthJP(d);

      const all = await loadRangeSince(d);
      const mm = d.getMonth(), yyyy = d.getFullYear();

      const filtered = (all||[]).filter(b=>{
        if(!b.birthday) return false;
        const bd = new Date(b.birthday); if(isNaN(bd)) return false;
        if (bd.getMonth() !== mm) return false;        // 月一致
        if (bd.getFullYear() > yyyy) return false;     // 未来生まれ除外（念のため）
        const a = ageOn(b.birthday, d);                // 当年齢
        return a!=null && a>=0 && a<=3;
      });

      if(!filtered.length){
        if(attempt < 5){ currentMonth = addMonths(d,-1); return renderMonth(currentMonth, attempt+1); }
        $list.innerHTML=''; setState({empty:true}); return;
      }
      $list.innerHTML = filtered.slice(0, heroLimit()).map(x=>cardHTML(x, d)).join('');
      setState({});
    }catch(e){
      console.error('[hero]', e);
      setState({ err:true });
    }
  }

  // 初期表示
  renderMonth(currentMonth);

  // 月ナビ
  $prev?.addEventListener('click', ()=>{ currentMonth = addMonths(currentMonth,-1); renderMonth(currentMonth); });
  $next?.addEventListener('click', ()=>{ currentMonth = addMonths(currentMonth, 1); renderMonth(currentMonth); });
  $jumpN?.addEventListener('click', ()=>{ currentMonth = addMonths(currentMonth, 1); renderMonth(currentMonth); });

  // 画面幅変化で件数再評価（SP⇄TB）
  window.matchMedia('(max-width: 599px)').addEventListener?.('change', ()=>renderMonth(currentMonth));
})();

/* ==========================================================
 * 新着の赤ちゃん（トップページ 3 件）
 * ========================================================== */
(() => {
  const $list = document.getElementById('recent-list');
  if (!$list) return;

  /* --- Supabase env（Home Hero v4 と同一ロジック） --- */
  function getEnv() {
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
    const BASE = metaUrl || 'https://hvhpfrksyytthupboaeo.supabase.co';
    const ANON = metaKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY';
    return { BASE, ANON };
  }

  async function sbGet(path) {
    const { BASE, ANON } = getEnv();
    const u = new window.URL(path, BASE);
    let r = await fetch(u.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      cache: 'no-store'
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const pickE = (b) => {
    const t = `${b?.species||''}`.toLowerCase();
    if (t.includes('レッサー')||t.includes('red panda'))  return '🦊';
    if (t.includes('パンダ') ||t.includes('panda'))      return '🐼';
    if (t.includes('ペンギン')||t.includes('penguin'))   return '🐧';
    if (t.includes('トラ')   ||t.includes('tiger'))      return '🐯';
    if (t.includes('ライオン')||t.includes('lion'))      return '🦁';
    if (t.includes('ゾウ')   ||t.includes('elephant'))  return '🐘';
    if (t.includes('キリン') ||t.includes('giraffe'))   return '🦒';
    if (t.includes('カバ')   ||t.includes('hippo'))     return '🦛';
    if (t.includes('コアラ') ||t.includes('koala'))     return '🐨';
    if (t.includes('ホッキョクグマ')||t.includes('polar')) return '🐻‍❄️';
    if (t.includes('カワウソ')||t.includes('otter'))    return '🦦';
    return '🐾';
  };

  async function load() {
    let rows = [];
    // 1) babies_public（誕生日降順）
    try {
      rows = await sbGet(
        '/rest/v1/babies_public?select=id,name,species,birthday,thumbnail_url,zoo_name' +
        '&order=birthday.desc.nullslast,id.desc&limit=3'
      );
    } catch (_) {
      // 2) フォールバック: babies + zoo embed
      try {
        const raw = await sbGet(
          '/rest/v1/babies?select=id,name,species,birthday,thumbnail_url,zoo:zoos(name)' +
          '&order=birthday.desc.nullslast,id.desc&limit=3'
        );
        rows = (raw || []).map(x => ({ ...x, zoo_name: x.zoo?.name || '' }));
      } catch (e2) {
        console.warn('[recent-babies]', e2);
      }
    }

    $list.innerHTML = '';
    if (!rows || !rows.length) return;

    // 経過日数を "N日前 / N週間前 / N月前" 表記に
    const agoLabel = iso => {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (diffDays < 1) return '今日';
      if (diffDays < 7) return `${diffDays}日前`;
      if (diffDays < 30) return `${Math.floor(diffDays/7)}週間前`;
      if (diffDays < 365) return `${Math.floor(diffDays/30)}ヶ月前`;
      return `${Math.floor(diffDays/365)}年前`;
    };

    for (const b of rows) {
      const name = b.name || '（名前未設定）';
      const zoo  = b.zoo_name || '';
      const href = `/babies/${encodeURIComponent(b.id)}/`;
      const emoji = pickE(b);
      const thumbHtml = b.thumbnail_url
        ? `<img src="${esc(b.thumbnail_url)}" alt="${esc(name)}" loading="lazy" onerror="this.parentNode.textContent='${emoji}'">`
        : emoji;
      const badge = agoLabel(b.birthday);

      const a = document.createElement('a');
      a.className = 'dbb-brow';
      a.href = href;
      a.setAttribute('role', 'listitem');
      a.innerHTML = `
        <div class="dbb-brow__thumb">${thumbHtml}</div>
        <div class="dbb-brow__info">
          <div class="dbb-brow__name">${esc(name)}</div>
          <div class="dbb-brow__species">${esc(b.species || '不明')}</div>
          ${zoo ? `<div class="dbb-brow__zoo">📍 ${esc(zoo)}</div>` : ''}
        </div>
        ${badge ? `<div class="dbb-brow__badge">${badge}</div>` : ''}`;
      $list.appendChild(a);
    }
  }

  load().catch(e => {
    console.error('[recent-babies]', e);
    $list.innerHTML = '';
  });
})();

/* ==========================================================
 * 最新ニュースプレビュー（トップページ 3 件）
 * ========================================================== */
(() => {
  const $list = document.getElementById('news-preview-list');
  if (!$list) return;

  function getEnv() {
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
    const BASE = metaUrl || 'https://hvhpfrksyytthupboaeo.supabase.co';
    const ANON = metaKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aHBmcmtzeXl0dGh1cGJvYWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNTc4MzQsImV4cCI6MjA3MjYzMzgzNH0.e5w3uSzajTHYdbtbVGDVFmQxcwe5HkyKSoVM7tMmKaY';
    return { BASE, ANON };
  }

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
  };

  async function load() {
    const { BASE, ANON } = getEnv();
    const url = new URL(`${BASE}/rest/v1/news_feed_v2`);
    url.searchParams.set('select', 'id,title,url,published_at,source_name,thumbnail_url');
    url.searchParams.set('order', 'published_at.desc,id.desc');
    url.searchParams.set('limit', '3');
    const res = await fetch(url.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // タイトルから簡易的にカテゴリ（誕生/イベント/お知らせ/訃報）を推定
  function categorize(title){
    const t = String(title || '');
    if (/(誕生|生まれ|赤ちゃん|出産|公開デビュー)/.test(t)) return { tag:'誕生', icon:'🐾', bg:'var(--news-tag-birth-bg)', color:'var(--ac)' };
    if (/(死去|逝去|亡くなり|訃報|死亡)/.test(t))               return { tag:'訃報', icon:'💐', bg:'var(--news-tag-death-bg)', color:'var(--news-tag-death-text)' };
    if (/(イベント|祭り|ナイト|ふれあい|GW|夏休み|開催)/.test(t)) return { tag:'イベント', icon:'🎉', bg:'var(--news-tag-event-bg)', color:'#E8963A' };
    return { tag:'お知らせ', icon:'🏛️', bg:'var(--news-tag-info-bg)', color:'#5B8AC4' };
  }

  load().then(rows => {
    $list.innerHTML = '';
    if (!rows?.length) return;
    for (const item of rows) {
      const cat = categorize(item.title);
      const a = document.createElement('a');
      a.className = 'dbb-nitem';
      a.href = item.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('role', 'listitem');
      a.innerHTML = `
        <div class="dbb-nitem__icon" style="background:${cat.bg}">${cat.icon}</div>
        <div class="dbb-nitem__body">
          <div class="dbb-nitem__tag" style="color:${cat.color}">${cat.tag}</div>
          <p class="dbb-nitem__title">${esc(item.title || '(無題)')}</p>
          <div class="dbb-nitem__date">${fmtDate(item.published_at)}${item.source_name ? ' · ' + esc(item.source_name) : ''}</div>
        </div>`;
      $list.appendChild(a);
    }
  }).catch(e => {
    console.warn('[news-preview]', e);
    $list.innerHTML = '';
  });
})();
