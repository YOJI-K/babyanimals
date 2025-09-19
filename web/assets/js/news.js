// assets/js/news.js
// News list v2 — SP最適化・Supabase/メタタグ両対応・簡易ページング

(() => {
  // ===== 小さなユーティリティ =====
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };
  const domain = (u) => {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
  };
  const qs = (id) => document.getElementById(id);

  const $q        = qs('q');
  const $source   = qs('source');
  const $sort     = qs('sort');
  const $list     = qs('list');
  const $empty    = qs('empty');
  const $skeleton = qs('skeleton-news');
  const $error    = qs('error');
  const $more     = qs('more');

  // ===== 状態 =====
  const PAGE_SIZE = 12;
  let PAGE = 1;
  let all = [];       // サーバーから受けた配列
  let filtered = [];  // 絞り込み後

  // ===== データ取得 =====
  async function fetchFromSupabase() {
    // window.SUPABASE（既存） or <meta> フォールバック
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();
    const SUPA_URL = (window.SUPABASE && (window.SUPABASE.URL || window.SUPABASE.SUPABASE_URL)) || metaUrl;
    const ANON     = (window.SUPABASE && (window.SUPABASE.ANON || window.SUPABASE.SUPABASE_ANON_KEY)) || metaKey;

    if (!SUPA_URL || !ANON) throw new Error('Supabase の URL / ANON KEY が設定されていません。');

    const url = new URL(`${SUPA_URL}/rest/v1/news_items`);
    url.searchParams.set('select', 'id,title,url,published_at,source_name,source_url,thumbnail_url');
    url.searchParams.set('order', 'published_at.desc,id.desc');
    url.searchParams.set('limit', '200'); // 初期は200件をクライアントでページング

    const res = await fetch(url.toString(), {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
    return res.json();
  }

  async function fetchMock() {
    const res = await fetch('/assets/mock/news.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('mock load failed');
    return res.json();
  }

  // ===== 描画 =====
  function cardHTML(item) {
    const img = item.thumbnail_url || 'https://placehold.co/640x360?text=No+Image';
    const dateStr = fmtDate(item.published_at);
    const host = item.source_name || domain(item.url) || '';
    const title = item.title || '(無題)';
    const href = item.url || item.source_url || '#';

    return `
      <a href="${href}" class="card" target="_blank" rel="noopener">
        <div class="thumb">
          <img src="${img}" loading="lazy" alt="${title.replace(/"/g, '&quot;')}">
        </div>
        <div class="pad">
          <div class="title">${title}</div>
          <div class="meta">
            <span>${dateStr}</span><span class="dot"></span><span>${host}</span>
          </div>
        </div>
      </a>
    `;
  }

  function applyFilter() {
    const q = ($q?.value || '').trim().toLowerCase();
    const src = ($source?.value || '').trim();

    filtered = all.filter(it => {
      const hitQ = !q || (it.title || '').toLowerCase().includes(q) || (it.source_name || '').toLowerCase().includes(q);
      let hitS = true;
      if (src === 'YouTube') {
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
    $empty.style.display = slice.length ? 'none' : 'block';

    const hasMore = slice.length < filtered.length;
    $more.style.display = hasMore ? 'inline-flex' : 'none';
    $more.disabled = !hasMore;

    // スケルトンOFF
    $skeleton.style.display = 'none';
  }

  function showError(msg) {
    $error.style.display = 'block';
    $error.textContent = msg;
  }

  // ===== イベント =====
  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  $q?.addEventListener('input', debounce(() => { PAGE = 1; render(); }, 200));
  $source?.addEventListener('change', () => { PAGE = 1; render(); });
  $sort?.addEventListener('change', () => { PAGE = 1; render(); });
  $more?.addEventListener('click', () => { PAGE += 1; render(); });

  // ===== 初期化 =====
  (async function init() {
    // 二重初期化防止
    if (window.__NEWS_V2_INITED) return;
    window.__NEWS_V2_INITED = true;

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
