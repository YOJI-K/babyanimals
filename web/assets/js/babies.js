// assets/js/babies.js
// Babies list v3 — ヘッダー/タブ統一, 年齢フィルタ(0-3), 近い誕生日順, 可愛いNo Image, スピナー, ページサイズ可変

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

  // ====== Supabase ======
  function getSupabaseEnv(){
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
    const URL = (window.SUPABASE && (window.SUPABASE.URL || window.SUPABASE.SUPABASE_URL)) || metaUrl;
    const ANON = (window.SUPABASE && (window.SUPABASE.ANON || window.SUPABASE.SUPABASE_ANON_KEY)) || metaKey;
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
      ZOOS = await fetchJSON('/rest/v1/zoos?select=id,name&order=name.asc');
      if ($zoo) {
        $zoo.innerHTML = `<option value="">すべての動物園</option>` + ZOOS.map(z => `<option value="${z.id}">${z.name}</option>`).join('');
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
    const title = x.name || '(no name)';
    const zoo   = x.zoo_name || '';
    const alt   = [x.name, x.species].filter(Boolean).join('（') + (x.species ? '）' : '');
    const soon  = x.birthday ? nextBirthdayDays(x.birthday) : Infinity;
    const isMonth = x.birthday ? (new Date(x.birthday).getMonth() === new Date().getMonth()) : false;

    const thumb = x.thumbnail_url
      ? `<div class="thumb"><img src="${x.thumbnail_url}" loading="lazy" decoding="async" alt="${alt}"></div>`
      : `<div class="thumb is-placeholder" role="img" aria-label="画像なし"></div>`;

    return `
      <a href="#" class="baby-card" onclick="return false;" aria-label="${title}（${x.species || '種別不明'}、${zoo || '園情報なし'}）の詳細（準備中）">
        ${thumb}
        ${soon <= 14 ? `<span class="soon-dot" title="もうすぐお誕生日"></span>` : ''}
        <div class="pad">
          <div class="title">${title}${x.species ? `（${x.species}）` : ''}</div>
          <div class="meta">
            ${sourcePillZoo(zoo)}
            ${pillBirthday(x.birthday)}
            ${pillAge(x.birthday)}
            ${soon <= 14 ? '<span class="pill pill--soon">もうすぐ</span>' : ''}
            ${isMonth ? '<span class="pill pill--month">今月🎂</span>' : ''}
          </div>
        </div>
      </a>
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
    const zooId = $zoo?.value || '';
    let data = BABIES.slice();

    if (q) {
      data = data.filter(x =>
        (x.name || '').toLowerCase().includes(q) ||
        (x.species || '').toLowerCase().includes(q) ||
        (x.zoo_name || '').toLowerCase().includes(q)
      );
    }
    if (zooId) {
      data = data.filter(x => String(x.zoo_id || '') === String(zooId));
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

  // ====== イベント ======
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

    try{
      $skel.style.display = 'grid';
      $error.style.display = 'none';

      await loadZoos();
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
