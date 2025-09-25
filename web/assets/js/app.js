// assets/js/app.js
// Global enhancements shared across pages (home / news / babies / calendar)

(() => {
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // ===== Demo data (replace with real source later) =====
  // birthday: "YYYY-MM-DD"
  const BABIES = [
    { id:'panda-01', name:'シャオシャオ', species:'ジャイアントパンダ', zoo:'上野動物園',        emoji:'🐼', birthday:'2025-09-27' },
    { id:'hippo-02', name:'モモ',        species:'コビトカバ',        zoo:'いしかわ動物園',    emoji:'🦛', birthday:'2025-09-28' },
    { id:'redp-03', name:'ココ',        species:'レッサーパンダ',    zoo:'市川市動植物園',    emoji:'🦊', birthday:'2025-10-03' },
    { id:'peng-04', name:'ピコ',        species:'フンボルトペンギン', zoo:'名古屋港水族館',    emoji:'🐧', birthday:'2025-09-07' }, // 過去
  ];

  document.addEventListener('DOMContentLoaded', () => {
    setActiveTabbarLink();
    headerOnScrollCompact();
    improveExternalUseHref();
    a11yTouchFocus();
    reduceMotionGuard();
    autoSetTabbarTitles();

    // Home-only widgets (guarded by element existence)
    mountHeroWeekend();
    mountCalendar(new Date());
    bindMonthNav();
    bindLike();
  });

  /**
   * Normalize path:
   * - Resolve relative href to absolute URL
   * - Trim trailing slash and resolve to /index.html
   * - Collapse multiple slashes
   */
  function normalizePath(inputHref) {
    try {
      const abs = new URL(inputHref, location.href);
      let p = abs.pathname;

      // collapse duplicate slashes
      p = p.replace(/\/{2,}/g, '/');

      // if ends with '/', treat as '/index.html'
      if (p.endsWith('/')) p += 'index.html';

      return p;
    } catch {
      // fallback: best-effort string ops
      let p = String(inputHref || '');
      p = p.replace(/\/{2,}/g, '/');
      if (/\/$/.test(p)) p += 'index.html';
      return p;
    }
  }

  /**
   * Highlight active tabbar link based on current normalized path.
   * No page-specific hacks; works with ../ relative hrefs as well.
   */
  function setActiveTabbarLink() {
    const current = normalizePath(location.pathname);

    const links = $$('.tabbar .tabbar__link');
    if (!links.length) return;

    // clear all first
    links.forEach(a => {
      a.classList.remove('is-active');
      a.removeAttribute('aria-current');
    });

    // find exact match by normalized path
    let matched = null;
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      const target = normalizePath(href);
      if (target === current) {
        matched = a;
        break;
      }
    }

    // if nothing matched, try a loose fallback for home
    if (!matched) {
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (/(\.|\/)index\.html$/.test(href) && /\/index\.html$/.test(current)) {
          matched = a;
          break;
        }
      }
    }

    if (matched) {
      matched.classList.add('is-active');
      matched.setAttribute('aria-current', 'page');
    }
  }

  /**
   * Compact header when scrolling down a bit (mobile-friendly).
   */
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

  /**
   * A11y: add focus styles on touch (iOS Safari sometimes drops :focus-visible)
   */
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

  /**
   * Respect prefers-reduced-motion: avoid JS smooth-scroll if any is used later
   */
  function reduceMotionGuard() {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      document.documentElement.style.scrollBehavior = 'auto';
    }
  }

  /**
   * External SVG <use> robustness:
   * Ensures `href` is set (not just xlink:href) and re-assigns to trigger Safari repaint.
   */
  function improveExternalUseHref() {
    $$('use').forEach((u) => {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (href) u.setAttribute('href', href);
    });
  }

  /**
   * Tabbar labels: set title attr so truncated text shows full on long-press/hover.
   */
  function autoSetTabbarTitles() {
    $$('.tabbar__link').forEach((link) => {
      const label = $('.tabbar__text', link);
      if (label && !link.title) link.title = label.textContent.trim();
    });
  }

  /* ====== 週末誕生日：ヒーロー ====== */
  function isWithinThisWeekend(date){
    const now = new Date(); // ローカル
    const day = now.getDay(); // 0=日
    const sat = new Date(now); sat.setDate(now.getDate() + ((6 - day + 7) % 7));
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    return date >= stripTime(sat) && date <= endOfDay(sun);
  }
  function stripTime(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function endOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999); }

  function mountHeroWeekend(){
    const wrap = $('#hero-list'); if(!wrap) return;
    wrap.innerHTML = '';
    const items = BABIES.filter(b => isWithinThisWeekend(new Date(b.birthday)));
    if(items.length === 0){
      // 週末該当が無ければ、直近の1〜2件を案内
      const soon = BABIES
        .map(b => ({...b, d:new Date(b.birthday)}))
        .filter(x => x.d >= stripTime(new Date()))
        .sort((a,b)=>a.d-b.d)
        .slice(0,2);
      wrap.insertAdjacentHTML('beforeend', `<p aria-live="polite">今週末のお誕生日はありません。直近の赤ちゃんをご紹介します。</p>`);
      soon.forEach(addHeroCard);
    }else{
      items.slice(0,2).forEach(addHeroCard);
    }
  }
  function addHeroCard(b){
    const daysLeft = Math.ceil((stripTime(new Date(b.birthday)) - stripTime(new Date())) / 86400000);
    const meta = daysLeft===0 ? '今日お誕生日！' : (daysLeft>0 ? `あと${daysLeft}日` : 'お誕生日は過ぎました');
    const el = document.createElement('div');
    el.className = 'hero-card';
    el.setAttribute('role','listitem');
    el.innerHTML = `
      <div class="hero-card__avatar" aria-hidden="true">${b.emoji}</div>
      <div>
        <p class="hero-card__title">${b.name}（${b.species}）</p>
        <p class="hero-card__meta">${b.zoo} ｜ 誕生日 ${b.birthday} ｜ ${meta}</p>
      </div>
      <button class="hero-card__cta" type="button" aria-label="${b.name}の詳細を見る">見る</button>
    `;
    $('#hero-list').appendChild(el);
  }

  /* ====== カレンダー ====== */
  let currentMonth = new Date();
  function mountCalendar(date){
    const grid = $('#cal-grid'); if(!grid) return;

    currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    grid.innerHTML = '';

    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const first = new Date(y,m,1);
    const startIdx = first.getDay();
    const lastDate = new Date(y, m + 1, 0).getDate();

    // 過去/未来の判定用
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

      // 誕生日がある日
      const hits = BABIES.filter(b => {
        const d = new Date(b.birthday);
        return d.getFullYear()===y && d.getMonth()===m && d.getDate()===day;
      });
      if(hits.length){
        const dot = document.createElement('span');
        dot.className = 'cal-day__dot';
        if(stripTime(cellDate) < today) dot.classList.add('cal-day__dot--past');
        cell.appendChild(dot);
        cell.title = hits.map(h=>`${h.name}（${h.species}）`).join(' / ');
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
  }
  function openDay(hits, dateObj){
    const yyyy = dateObj.getFullYear(), mm = dateObj.getMonth()+1, dd = dateObj.getDate();
    const list = hits.map(h=>`・${h.name}（${h.species} / ${h.zoo}）`).join('\n');
    alert(`${yyyy}年${mm}月${dd}日の誕生日\n\n${list}`);
  }
  function bindMonthNav(){
    const prev = $('#prev-month'), next = $('#next-month');
    if(prev) prev.addEventListener('click', ()=> {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1);
      mountCalendar(d);
    });
    if(next) next.addEventListener('click', ()=> {
      const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1);
      mountCalendar(d);
    });
  }

  /* ====== お気に入り（トップ保存） ====== */
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
      // 小さなアニメ（reduced-motionはCSS側で抑制）
      btn.animate(
        [{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],
        {duration:240,easing:'ease-out'}
      );
    }, {passive:false});
  }
})();
