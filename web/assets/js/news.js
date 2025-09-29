// assets/js/news.js
// News list v3 — ヘッダー/タブ統一, 可愛いNo Image, NEWバッジ, ピル, ページサイズ可変

(() => {
  // ===== Utils =====
  const qs = (id) => document.getElementById(id);
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };
  const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const today = () => new Date();

  function getPageSize() {
    const sp = new URLSearchParams(location.search);
    const qp = Number(sp.get('pagesize'));
    if (!Number.isNaN(qp) && qp >= 1 && qp <= 50) return qp;
    const fromData = Number(document.body?.dataset?.pageSize);
    return (!Number.isNaN(fromData) && fromData >= 1) ? fromData : 12;
  }

  // ===== Nodes =====
  const $q        = qs('q');
  const $source   = qs('source');
  const $sort     = qs('sort');
  const $list     = qs('list');
  const $empty    = qs('empty');
  const $skeleton = qs('skeleton-news');
  const $error    = qs('error');
  const $more     = qs('more');

  // ===== State =====
  let PAGE_SIZE = getPageSize();
  let PAGE = 1;
  let all = [];      // サーバー配列
  let filtered = []; // 絞り込み結果

  // ===== Data =====
  async function fetchFromSupabase() {
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
    const SUPA_URL = (window.SUPABASE && (window.SUPABASE.URL || window.SUPABASE.SUPABASE_URL)) || metaUrl;
    const ANON     = (window.SUPABASE && (window.SUPABASE.ANON || window.SUPABASE.SUPABASE_ANON_KEY)) || metaKey;

    if (!SUPA_URL || !ANON) throw new Error('Supabase の URL / ANON KEY が設定されていません。');

    const url = new URL(`${SUPA_URL}/rest/v1/news_feed_v2`);
    url.searchParams.set('select', 'id,title,url,published_at,source_name,source_url,thumbnail_url,kind,featured');
    url.searchParams.set('order', 'published_at.desc,id.desc');
    url.searchParams.set('limit', '200');

    const res = await fetch(url.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    return res.json();
  }

  async function fetchMock() {
    // 任意：公開環境にモックは不要。存在しない場合は握りつぶす
    try {
      const res = await fetch('../assets/mock/news.json', { cache: 'no-store' });
      if (!res.ok) throw 0;
      return res.json();
    } catch { return []; }
  }

  // ===== View helpers =====
  function sourcePill(item){
    const base = (cls, text) => `<span class="pill ${cls}">${text}</span>`;
    const isYT = /youtube/i.test(item.source_name || item.url || '');
    const zooish = /(動物園|zoo|園|市立|県立)/i.test(item.source_name || '');
    if (isYT)   return base('pill--yt',  '▶️ YouTube');
    if (zooish) return base('pill--zoo', '🏛️動物園公式');
    return base('pill--web', '🌐 Web');
  }
  function isNew(pubISO){
    const pub = new Date(pubISO);
    const diff = (today() - pub) / 86400000;
    return diff >= 0 && diff <= 7;
  }

  function cardHTML(item) {
    const dateStr = fmtDate(item.published_at);
    const host = item.source_name || domain(item.url) || '';
    const title = item.title || '(無題)';
    const href = item.url || item.source_url || '#';
    const hasImg = !!item.thumbnail_url;

    return `
      <a href="${href}" class="news-card" target="_blank" rel="noopener" aria-label="${title.replace(/"/g,'&quot;')}">
        <div class="thumb ${hasImg ? '' : 'is-placeholder'}">
          ${hasImg ? `<img src="${item.thumbnail_url}" loading="lazy" decoding="async" alt="${title.replace(/"/g,'&quot;')}">` : ''}
        </div>
        <div class="pad">
          <div class="title">${title}</div>
          <div class="meta">
            <span>${dateStr}</span><span class="dot"></span><span>${host}</span><span class="dot"></span>${sourcePill(item)}
            ${isNew(item.published_at) ? '<span class="pill pill--new">NEW</span>' : ''}
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

  // ===== Filter/Sort/Render =====
  function applyFilter() {
    const q = ($q?.value || '').trim().toLowerCase();
    const src = ($source?.value || '').trim();

    filtered = all.filter(it => {
      const hitQ = !q || (it.title || '').toLowerCase().includes(q) || (it.source_name || '').toLowerCase().includes(q);
      let hitS = true;
      if (src === '公式記事') {
        hitS = it.kind === 'article';
      } else if (src === 'YouTube') {
        hitS = /youtube/i.test(it.source_name || '');
      } else if (src === 'blog') {
        hitS = !/youtube/i.test(it.source_name || '');
      }
      return hitQ && hitS;
    });

    const asc = $sort?.value === 'asc';
    filtered.sort((a, b) => {
      const ad = new Date(a.published_at || 0).getTime();
      const bd = new Date(b.published_at || 0).getTime();
      if (ad !== bd) return asc ? ad - bd : bd - ad;
      return asc ? (a.id > b.id ? 1 : -1) : (a.id < b.id ? 1 : -1);
    });
  }

  function render() {
    applyFilter();

    const end = PAGE * PAGE_SIZE;
    const slice = filtered.slice(0, end);

    $list.innerHTML = slice.map(cardHTML).join('');
    bindImageFallback($list);

    $empty.style.display = slice.length ? 'none' : 'block';

    const hasMore = slice.length < filtered.length;
    $more.style.display = hasMore ? 'inline-flex' : 'none';
    $more.disabled = !hasMore;

    $skeleton.style.display = 'none';
     if ($more) $more.classList.remove('loading');  
  }

  function showError(msg) {
    $error.style.display = 'block';
    $error.textContent = msg;
  }

  // ===== Events =====
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  $q?.addEventListener('input', debounce(() => { PAGE = 1; render(); }, 200));
  $source?.addEventListener('change', () => { PAGE = 1; render(); });
  $sort?.addEventListener('change', () => { PAGE = 1; render(); });
  $more?.addEventListener('click', () => {
  $more.classList.add('loading'); 
  PAGE += 1;
  render();
});

  // optional: autoload (= true when ?autoload=1)
  (function setupAutoload(){
    const sp = new URLSearchParams(location.search);
    if (sp.get('autoload') !== '1') return;
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries)=>{
      if (entries.some(e=>e.isIntersecting)){
        if ($more && !$more.disabled && $more.style.display !== 'none') {
          $more.click();
        }
      }
    }, { rootMargin: '400px 0px 400px 0px' });
    if ($more) io.observe($more);
  })();

  // ===== Init =====
  (async function init() {
    if (window.__NEWS_V3_INITED) return;
    window.__NEWS_V3_INITED = true;

    try {
      $skeleton.style.display = 'grid';
      $error.style.display = 'none';

      try {
        all = await fetchFromSupabase();
      } catch (e) {
        console.warn('[news] supabase error, try mock:', e);
        all = await fetchMock();
      }

      PAGE = 1;
      render();
    } catch (e) {
      console.error(e);
      $skeleton.style.display = 'none';
      showError('データの読み込みに失敗しました。時間をおいて再度お試しください。');
    }
  })();
})();
